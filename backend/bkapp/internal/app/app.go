// Package app wires the API together. cmd/api runs it as a long lived server; api/index.go runs the
// same thing as a serverless function, where the process only lives for a few requests.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/db"
	"csimap/bkapp/internal/email"
	"csimap/bkapp/internal/httpapi"
	"csimap/bkapp/internal/push"
	"csimap/bkapp/internal/settings"
	"csimap/bkapp/internal/social"
)

type App struct {
	Handler http.Handler
	Config  config.Config
	Jobs    []func(context.Context) error
	Close   func()

	api *httpapi.Server
}

// StartBackground starts the housekeeping the HTTP layer needs, such as forgetting old rate limit
// counters. It stops when the channel closes.
func (a *App) StartBackground(stop <-chan struct{}) {
	a.api.StartBackground(stop)
}

func Build(ctx context.Context, logger *slog.Logger, migrate bool) (*App, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, fmt.Errorf("config: %w", err)
	}

	site, err := campus.Load()
	if err != nil {
		return nil, fmt.Errorf("campus: %w", err)
	}

	openCtx, cancelOpen := context.WithTimeout(ctx, 30*time.Second)
	defer cancelOpen()
	pool, err := db.Open(openCtx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("database: %w", err)
	}
	if migrate {
		applied, err := db.Migrate(openCtx, pool)
		if err != nil {
			pool.Close()
			return nil, fmt.Errorf("database: %w", err)
		}
		for _, name := range applied {
			logger.Info("applied migration", "name", name)
		}
	}

	renderer, err := email.NewRenderer(site.Brand)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("email templates: %w", err)
	}
	mailer, err := newMailer(cfg, renderer, logger)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("email: %w", err)
	}

	authService, err := auth.NewService(auth.NewPostgresStore(pool), mailer, cfg.AuthSecret, site.EmailDomains)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("auth: %w", err)
	}
	socialService, err := social.NewService(pool, site, cfg.TicketSecret)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("social: %w", err)
	}

	// Notification keys live in the database, so every instance and every deploy signs with the same ones.
	if err := push.ResolveKeys(ctx, pool, &cfg); err != nil {
		logger.Warn("notifications are off: their keys could not be set up", "error", err)
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

	api := httpapi.New(cfg, logger, site, authService, socialService, pushService, settings.NewService(pool))
	return &App{
		Handler: api.Handler(),
		Config:  cfg,
		Jobs:    []func(context.Context) error{authService.Cleanup, socialService.Cleanup},
		Close:   pool.Close,
		api:     api,
	}, nil
}

func newMailer(cfg config.Config, renderer *email.Renderer, logger *slog.Logger) (email.Sender, error) {
	switch cfg.EmailMode {
	case config.EmailModeSMTP:
		return email.NewSMTP(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUsername, cfg.SMTPPassword, cfg.EmailFrom, renderer)
	case config.EmailModeGmail:
		return email.NewGmail(cfg.GmailClientID, cfg.GmailSecret, cfg.GmailRefresh, cfg.EmailFrom, renderer)
	case config.EmailModeResend:
		return email.NewResend(cfg.ResendAPIKey, cfg.EmailFrom, renderer), nil
	case config.EmailModeLog:
		return email.NewLog(logger), nil
	default:
		return nil, fmt.Errorf("unsupported EMAIL_MODE %q", cfg.EmailMode)
	}
}
