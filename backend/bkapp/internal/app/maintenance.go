package app

import (
	"context"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"time"
)

const maintenanceTimeout = 50 * time.Second

// Maintenance runs the cleanup jobs that the long lived server runs on a timer. Serverless hosts kill
// background goroutines when a response is sent, so there a scheduler calls this instead.
//
// The secret is the only thing guarding it. Without one the route answers 404 like any unknown path,
// so a missing setting can never leave it open. Vercel's scheduler sends `Authorization: Bearer
// $CRON_SECRET`, which is the header this expects.
func Maintenance(secret string, jobs []func(context.Context) error, logger *slog.Logger) http.Handler {
	want := []byte("Bearer " + secret)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")

		if secret == "" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			w.Header().Set("Allow", "GET, POST")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		got := []byte(r.Header.Get("Authorization"))
		if subtle.ConstantTimeCompare(got, want) != 1 {
			logger.Warn("maintenance call refused")
			http.NotFound(w, r)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), maintenanceTimeout)
		defer cancel()
		for _, job := range jobs {
			if err := job(ctx); err != nil {
				logger.Error("cleanup failed", "error", err)
				http.Error(w, "cleanup failed", http.StatusInternalServerError)
				return
			}
		}
		logger.Info("cleanup finished", "jobs", len(jobs))
		w.WriteHeader(http.StatusNoContent)
	})
}
