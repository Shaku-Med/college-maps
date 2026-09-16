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

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/db"
	"csimap/bkapp/internal/email"
	"csimap/bkapp/internal/httpapi"
	"csimap/bkapp/internal/push"
	"csimap/bkapp/internal/social"
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
	if err := config.EnsureNotificationEnv(); err != nil {
		logger.Warn("could not prepare notification keys", "error", err)
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	site, err := campus.Load()
	if err != nil {
		return fmt.Errorf("campus: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	openCtx, cancelOpen := context.WithTimeout(ctx, 30*time.Second)
	pool, err := db.Open(openCtx, cfg.DatabaseURL)
	var applied []string
	if err == nil {
		applied, err = db.Migrate(openCtx, pool)
	}
	cancelOpen()
	if err != nil {
		if pool != nil {
			pool.Close()
		}
		return fmt.Errorf("database: %w", err)
	}
	defer pool.Close()
	for _, name := range applied {
		logger.Info("applied migration", "name", name)
	}

	renderer, err := email.NewRenderer(site.Brand)
	if err != nil {
		return fmt.Errorf("email templates: %w", err)
	}
	var mailer email.Sender
	switch cfg.EmailMode {
	case config.EmailModeSMTP:
		mailer, err = email.NewSMTP(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUsername, cfg.SMTPPassword, cfg.EmailFrom, renderer)
		if err != nil {
			return fmt.Errorf("email: %w", err)
		}
	case config.EmailModeGmail:
		mailer, err = email.NewGmail(cfg.GmailClientID, cfg.GmailSecret, cfg.GmailRefresh, cfg.EmailFrom, renderer)
		if err != nil {
			return fmt.Errorf("email: %w", err)
		}
	case config.EmailModeResend:
		mailer = email.NewResend(cfg.ResendAPIKey, cfg.EmailFrom, renderer)
	case config.EmailModeLog:
		mailer = email.NewLog(logger)
	default:
		return fmt.Errorf("unsupported EMAIL_MODE %q", cfg.EmailMode)
	}

	authService, err := auth.NewService(auth.NewPostgresStore(pool), mailer, cfg.AuthSecret, site.EmailDomains)
	if err != nil {
		return fmt.Errorf("auth: %w", err)
	}
	socialService, err := social.NewService(pool, site, cfg.TicketSecret)
	if err != nil {
		return fmt.Errorf("social: %w", err)
	}
	pushService := push.New(pool, cfg, logger)
	if cfg.PushAvailable {
		logger.Info("push notifications enabled")
	} else {
		logger.Info("push notifications off")
	}
	socialService.SetNotify(func(senderID string, userIDs []string, title, body, path string) {
		go pushService.Notify(context.Background(), senderID, userIDs, push.Message{Title: title, Body: body, URL: path})
	})
	go cleanupLoop(ctx, logger, authService.Cleanup, socialService.Cleanup)

	api := httpapi.New(cfg, logger, site, authService, socialService, pushService)
	api.StartBackground(ctx.Done())

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           api.Handler(),
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
