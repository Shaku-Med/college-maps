package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/push"
	"csimap/bkapp/internal/settings"
	"csimap/bkapp/internal/social"
)

type Server struct {
	handler  http.Handler
	limiters []*rateLimiter
}

func New(
	cfg config.Config,
	logger *slog.Logger,
	site *campus.Campus,
	authService *auth.Service,
	socialService *social.Service,
	pushService *push.Service,
	settingsService *settings.Service,
) *Server {
	ip := clientIPFunc(cfg.ClientIPHeader)
	general := newRateLimiter(20_000, time.Minute)
	codeRequests := newRateLimiter(200, 15*time.Minute)
	codeChecks := newRateLimiter(800, 15*time.Minute)
	accountDataIP := newRateLimiter(4_000, 15*time.Minute)
	wipeUser := newRateLimiter(8, 15*time.Minute)
	exportUser := newRateLimiter(40, 15*time.Minute)
	pushUser := newRateLimiter(40, 15*time.Minute)
	settingsUser := newRateLimiter(60, 15*time.Minute)

	a := &authHandlers{
		service:  authService,
		social:   socialService,
		push:     pushService,
		settings: settingsService,
		logger:   logger,
		cookie:   sessionCookie(cfg.IsProduction()),
	}
	ph := &pushHandlers{service: pushService}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealth)
	mux.HandleFunc("GET /v1/places", handlePlaces(site.Places))
	mux.Handle("POST /v1/auth/code", limitRoute(codeRequests, ip, http.HandlerFunc(a.requestCode)))
	mux.Handle("POST /v1/auth/verify", limitRoute(codeChecks, ip, http.HandlerFunc(a.verifyCode)))
	mux.HandleFunc("POST /v1/auth/signout", a.signOut)
	mux.HandleFunc("POST /v1/auth/signout-all", a.requireUser(a.signOutEverywhere))
	mux.HandleFunc("GET /v1/me", a.requireUser(a.me))
	mux.Handle("GET /v1/me/export", limitRoute(accountDataIP, ip, a.requireUser(limitUser(exportUser, a.exportMe))))
	mux.HandleFunc("PATCH /v1/me", a.requireUser(a.updateMe))
	mux.Handle("DELETE /v1/me", limitRoute(accountDataIP, ip, a.requireUser(limitUser(wipeUser, a.deleteMe))))
	mux.HandleFunc("GET /v1/push/config", ph.config)
	mux.Handle("POST /v1/push/subscriptions", limitRoute(accountDataIP, ip, a.requireUser(limitUser(pushUser, ph.save))))
	mux.Handle("DELETE /v1/push/subscriptions", limitRoute(accountDataIP, ip, a.requireUser(ph.remove)))
	if settingsService != nil {
		st := &settingsHandlers{service: settingsService}
		mux.Handle("GET /v1/me/settings", limitRoute(accountDataIP, ip, a.requireUser(st.get)))
		mux.Handle("PATCH /v1/me/settings", limitRoute(accountDataIP, ip, a.requireUser(limitUser(settingsUser, st.save))))
	}
	if socialService != nil {
		sh := &socialHandlers{service: socialService, logger: logger}
		mux.HandleFunc("GET /v1/friends", a.requireUser(sh.overview))
		mux.HandleFunc("POST /v1/friends/requests", a.requireUser(sh.sendRequest))
		mux.HandleFunc("POST /v1/friends/requests/{username}/accept", a.requireUser(sh.acceptRequest))
		mux.HandleFunc("DELETE /v1/friends/requests/{username}", a.requireUser(sh.removeRequest))
		mux.HandleFunc("DELETE /v1/friends/{username}", a.requireUser(sh.unfriend))
		mux.HandleFunc("POST /v1/blocks", a.requireUser(sh.block))
		mux.HandleFunc("DELETE /v1/blocks/{username}", a.requireUser(sh.unblock))
		mux.HandleFunc("GET /v1/meetups", a.requireUser(sh.listMeetups))
		mux.HandleFunc("POST /v1/meetups", a.requireUser(sh.createMeetup))
		mux.HandleFunc("GET /v1/meetups/public", a.requireUser(sh.listPublicMeetups))
		mux.HandleFunc("POST /v1/meetups/public", a.requireUser(sh.createPublicMeetup))
		mux.HandleFunc("GET /v1/meetups/{id}", a.requireUser(sh.getMeetup))
		mux.HandleFunc("POST /v1/meetups/{id}/join", a.requireUser(sh.joinPublicMeetup))
		mux.HandleFunc("POST /v1/meetups/{id}/respond", a.requireUser(sh.respond))
		mux.HandleFunc("POST /v1/meetups/{id}/leave", a.requireUser(sh.leave))
		mux.HandleFunc("POST /v1/meetups/{id}/end", a.requireUser(sh.end))
		mux.HandleFunc("POST /v1/meetups/{id}/ticket", a.requireUser(sh.liveTicket))
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})

	handler := chain(mux,
		recoverPanics(logger),
		logRequests(logger),
		securityHeaders,
		cors(cfg.AllowedOrigins),
		rateLimit(general, ip),
		sameOriginWrites(cfg.AllowedOrigins),
		limitBody,
	)
	return &Server{handler: handler, limiters: []*rateLimiter{general, codeRequests, codeChecks, accountDataIP, wipeUser, exportUser, pushUser, settingsUser}}
}

func (s *Server) Handler() http.Handler {
	return s.handler
}

func (s *Server) StartBackground(stop <-chan struct{}) {
	for _, limiter := range s.limiters {
		limiter.startSweeper(stop)
	}
}

func limitRoute(rl *rateLimiter, ip func(*http.Request) string, next http.Handler) http.Handler {
	return rateLimit(rl, ip)(next)
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func handlePlaces(list []campus.Place) http.HandlerFunc {
	body, err := json.Marshal(map[string]any{"places": list})
	if err != nil {
		panic(err)
	}
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}
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
