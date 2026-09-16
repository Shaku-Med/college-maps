// Package handler is the entry point for serverless hosts. Vercel builds every file under api/ into
// a function and calls the exported Handler, so there is no process of our own and no listener.
//
// The same API also runs as an ordinary server from cmd/api. Both build it through internal/app, so
// there is only one place where the pieces are wired together.
package handler

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"csimap/bkapp/internal/app"
	"csimap/bkapp/internal/config"
)

var (
	once     sync.Once
	routes   http.Handler
	buildErr error
	logger   = slog.New(slog.NewJSONHandler(os.Stdout, nil))
)

func Handler(w http.ResponseWriter, r *http.Request) {
	once.Do(build)
	if buildErr != nil {
		// Logged once at build time. The reason stays out of the response.
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"The server is not available right now."}`))
		return
	}
	routes.ServeHTTP(w, r)
}

func build() {
	// Settings come from the host's environment here; a missing .env file is normal and fine.
	if _, _, err := config.LoadEnvFile(); err != nil {
		logger.Warn("could not read an env file, using the host's settings", "error", err)
	}
	// The server config insists on a port because it listens on one. This function never does.
	if os.Getenv("PORT") == "" {
		_ = os.Setenv("PORT", "8080")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	// Schema changes are applied by cmd/migrate, not on every cold start.
	built, err := app.Build(ctx, logger, false)
	if err != nil {
		buildErr = err
		logger.Error("could not start the api", "error", err)
		return
	}

	// Rate limit counters still need sweeping while this instance is alive, or the table fills up and
	// starts refusing visitors it has never seen. Nothing closes this: the host disposes of us.
	built.StartBackground(make(chan struct{}))

	// Cleanup cannot run on a timer here: the host freezes the instance once a response is sent.
	// A scheduler calls this path daily instead.
	mux := http.NewServeMux()
	mux.Handle("/v1/maintenance", app.Maintenance(built.Config.CronSecret, built.Jobs, logger))
	mux.Handle("/", built.Handler)
	routes = mux

	if built.Config.CronSecret == "" {
		logger.Warn("CRON_SECRET is not set, so expired sessions and unfinished accounts will not be cleaned up")
	}
	logger.Info("api ready", "env", built.Config.Env, "email", built.Config.EmailMode)
}
