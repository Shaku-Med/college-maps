package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"csimap/bkapp/internal/app"
	"csimap/bkapp/internal/config"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	env, file, err := config.LoadEnvFile()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	logger.Info("loading settings", "env", env, "file", file)
	if err := config.LoadNotificationFile(); err != nil {
		logger.Warn("could not read the notification keys file", "error", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	built, err := app.Build(ctx, logger, true)
	if err != nil {
		return err
	}
	defer built.Close()
	built.StartBackground(ctx.Done())
	cfg := built.Config

	go cleanupLoop(ctx, logger, built.Jobs...)

	// A host that suspends an idle instance cannot be counted on to fire that timer, so where a
	// scheduler is set up it can run the same jobs over HTTP. Without a secret the route stays shut.
	handler := built.Handler
	if cfg.CronSecret != "" {
		mux := http.NewServeMux()
		mux.Handle("/v1/maintenance", app.Maintenance(cfg.CronSecret, built.Jobs, logger))
		mux.Handle("/", handler)
		handler = mux
	}

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening", "port", cfg.Port, "env", cfg.Env, "email", cfg.EmailMode)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

func cleanupLoop(ctx context.Context, logger *slog.Logger, jobs ...func(context.Context) error) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, job := range jobs {
				runCtx, cancel := context.WithTimeout(ctx, time.Minute)
				if err := job(runCtx); err != nil {
					logger.Error("cleanup failed", "error", err)
				}
				cancel()
			}
		}
	}
}
