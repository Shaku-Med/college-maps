package server

import (
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

const maxBodyBytes = 1 << 10

func chain(h http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Cross-Origin-Resource-Policy", "same-site")
		next.ServeHTTP(w, r)
	})
}

// Tickets travel in headers or the stream URL, never cookies, so CORS stays without credentials.
func cors(allowed map[string]struct{}) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			_, ok := allowed[origin]
			if origin != "" {
				w.Header().Add("Vary", "Origin")
			}
			if ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				if !ok {
					writeError(w, http.StatusForbidden, "origin not allowed")
					return
				}
				h := w.Header()
				h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				h.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Everything except the health check comes from the web app, so a missing or foreign Origin is refused.
func requireOrigin(allowed map[string]struct{}) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/healthz" {
				if _, ok := allowed[r.Header.Get("Origin")]; !ok {
					writeError(w, http.StatusForbidden, "origin not allowed")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func rateLimit(rl *rateLimiter, ip func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/healthz" || r.URL.Path == "/v1/stream" {
				next.ServeHTTP(w, r)
				return
			}
			if !rl.allow(ip(r)) {
				w.Header().Set("Retry-After", "60")
				writeError(w, http.StatusTooManyRequests, "too many requests")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func recoverPanics(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					if rec == http.ErrAbortHandler {
						panic(rec)
					}
					logger.Error("panic", "path", r.URL.Path, "error", rec)
					writeError(w, http.StatusInternalServerError, "internal error")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// Only the path is logged: stream URLs carry a ticket in the query string.
func logRequests(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			logger.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status, "duration", time.Since(start))
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController reach Flush and write deadlines for streams.
func (s *statusRecorder) Unwrap() http.ResponseWriter {
	return s.ResponseWriter
}

// Only the last entry of a list header is trusted: earlier ones are client supplied and forgeable.
func clientIPFunc(header string) func(*http.Request) string {
	return func(r *http.Request) string {
		if header != "" {
			values := strings.Split(r.Header.Get(header), ",")
			value := strings.TrimSpace(values[len(values)-1])
			if ip := net.ParseIP(value); ip != nil {
				return ip.String()
			}
		}
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			return r.RemoteAddr
		}
		return host
	}
}
