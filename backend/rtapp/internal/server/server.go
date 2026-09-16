package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"mime"
	"net/http"
	"strings"
	"sync"
	"time"

	"csimap/rtapp/internal/config"
	"csimap/rtapp/internal/hub"
	"csimap/rtapp/internal/ticket"
)

const (
	heartbeatEvery    = 20 * time.Second
	writeTimeout      = 10 * time.Second
	maxAccuracyMeters = 5000
	// Campus Wi-Fi NATs hundreds of phones onto one address. Per-member caps are the real fairness.
	maxStreamsPerIP = 4000
)

type Server struct {
	handler  http.Handler
	limiters []*rateLimiter
}

type handlers struct {
	secret    []byte
	hub       *hub.Hub
	logger    *slog.Logger
	ip        func(*http.Request) string
	positions *rateLimiter
	now       func() time.Time

	mu      sync.Mutex
	streams map[string]int
}

func New(cfg config.Config, logger *slog.Logger, h *hub.Hub) *Server {
	ip := clientIPFunc(cfg.ClientIPHeader)
	general := newRateLimiter(20_000, time.Minute)
	a := &handlers{
		secret:    cfg.TicketSecret,
		hub:       h,
		logger:    logger,
		ip:        ip,
		positions: newRateLimiter(40, time.Minute),
		now:       time.Now,
		streams:   map[string]int{},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /v1/stream", a.stream)
	mux.HandleFunc("POST /v1/position", a.withTicket(a.postPosition))
	mux.HandleFunc("POST /v1/leave", a.withTicket(a.leave))
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})

	handler := chain(mux,
		recoverPanics(logger),
		logRequests(logger),
		securityHeaders,
		cors(cfg.AllowedOrigins),
		rateLimit(general, ip),
		requireOrigin(cfg.AllowedOrigins),
	)
	return &Server{handler: handler, limiters: []*rateLimiter{general, a.positions}}
}

func (s *Server) Handler() http.Handler {
	return s.handler
}

func (s *Server) StartBackground(stop <-chan struct{}) {
	for _, limiter := range s.limiters {
		limiter.startSweeper(stop)
	}
}

func (a *handlers) verify(token string) (ticket.Claims, bool) {
	claims, err := ticket.Verify(a.secret, token, a.now())
	return claims, err == nil
}

// EventSource cannot send headers, so the stream takes its ticket from the query string.
func (a *handlers) stream(w http.ResponseWriter, r *http.Request) {
	claims, ok := a.verify(r.URL.Query().Get("ticket"))
	if !ok {
		writeError(w, http.StatusUnauthorized, "invalid ticket")
		return
	}

	ip := a.ip(r)
	if !a.openStream(ip) {
		writeError(w, http.StatusTooManyRequests, "too many open streams")
		return
	}
	defer a.closeStream(ip)

	sub, snapshot, err := a.hub.Subscribe(claims.Room, claims.Member)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "meetup is full, try again soon")
		return
	}
	defer a.hub.Unsubscribe(sub)

	// The server read timeout would otherwise cancel a healthy stream once it runs out.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	send := func(event string, data []byte) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(writeTimeout))
		var werr error
		if event == "" {
			_, werr = fmt.Fprint(w, ": ping\n\n")
		} else {
			_, werr = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
		}
		return werr == nil && rc.Flush() == nil
	}

	_ = rc.SetWriteDeadline(time.Now().Add(writeTimeout))
	if _, err := fmt.Fprint(w, "retry: 3000\n\n"); err != nil {
		return
	}
	initial, _ := json.Marshal(map[string]any{"you": claims.Member, "positions": snapshot})
	if !send("snapshot", initial) {
		return
	}

	heartbeat := time.NewTicker(heartbeatEvery)
	defer heartbeat.Stop()
	expiry := time.NewTimer(claims.ExpiresAt().Sub(a.now()))
	defer expiry.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-expiry.C:
			send("expired", []byte("{}"))
			return
		case <-heartbeat.C:
			if !send("", nil) {
				return
			}
		case e, open := <-sub.Events():
			if !open || !send(e.Type, e.Data) {
				return
			}
		}
	}
}

func (a *handlers) openStream(ip string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.streams[ip] >= maxStreamsPerIP {
		return false
	}
	a.streams[ip]++
	return true
}

func (a *handlers) closeStream(ip string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.streams[ip] <= 1 {
		delete(a.streams, ip)
		return
	}
	a.streams[ip]--
}

func (a *handlers) withTicket(next func(http.ResponseWriter, *http.Request, ticket.Claims)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, found := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims, ok := a.verify(token)
		if !found || !ok {
			writeError(w, http.StatusUnauthorized, "invalid ticket")
			return
		}
		next(w, r, claims)
	}
}

type positionBody struct {
	Lat      *float64 `json:"lat"`
	Lng      *float64 `json:"lng"`
	Accuracy *float64 `json:"accuracy"`
	Heading  *float64 `json:"heading"`
}

func finite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

func (b positionBody) valid() bool {
	if b.Lat == nil || b.Lng == nil || b.Accuracy == nil {
		return false
	}
	if !finite(*b.Lat) || *b.Lat < -90 || *b.Lat > 90 || !finite(*b.Lng) || *b.Lng < -180 || *b.Lng > 180 {
		return false
	}
	if !finite(*b.Accuracy) || *b.Accuracy < 0 || *b.Accuracy > maxAccuracyMeters {
		return false
	}
	return b.Heading == nil || (finite(*b.Heading) && *b.Heading >= 0 && *b.Heading < 360)
}

func round(v float64, places int) float64 {
	scale := math.Pow(10, float64(places))
	return math.Round(v*scale) / scale
}

func (a *handlers) postPosition(w http.ResponseWriter, r *http.Request, claims ticket.Claims) {
	if !a.positions.allow(claims.Room + "|" + claims.Member) {
		w.Header().Set("Retry-After", "5")
		writeError(w, http.StatusTooManyRequests, "sending location too often")
		return
	}

	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "send JSON with Content-Type: application/json")
		return
	}
	var body positionBody
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil || decoder.More() || !body.valid() {
		writeError(w, http.StatusBadRequest, "invalid position")
		return
	}

	p := hub.Position{
		Member:   claims.Member,
		Name:     claims.Name,
		Lat:      round(*body.Lat, 6),
		Lng:      round(*body.Lng, 6),
		Accuracy: math.Round(*body.Accuracy),
	}
	if body.Heading != nil {
		heading := math.Round(*body.Heading)
		if heading >= 360 {
			heading = 0
		}
		p.Heading = &heading
	}
	if err := a.hub.Publish(claims.Room, p); err != nil {
		if errors.Is(err, hub.ErrFull) {
			writeError(w, http.StatusServiceUnavailable, "meetup is full, try again soon")
			return
		}
		a.logger.Error("publish failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *handlers) leave(w http.ResponseWriter, _ *http.Request, claims ticket.Claims) {
	a.hub.Leave(claims.Room, claims.Member)
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
