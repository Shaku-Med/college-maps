// Package app wires the API together.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/db"
	"csimap/bkapp/internal/email"
	"csimap/bkapp/internal/httpapi"
	"csimap/bkapp/internal/issues"
	"csimap/bkapp/internal/push"
	"csimap/bkapp/internal/settings"
	"csimap/bkapp/internal/social"
	"csimap/bkapp/internal/turnstile"
)

type App struct {
	Handler http.Handler
	Config  config.Config
	Jobs    []func(context.Context) error
	Close   func()

	api *httpapi.Server
}

// StartBackground starts the housekeeping the HTTP layer needs, such as forgetting old rate limit counters.
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

	human, err := humanCheck(cfg)
	if err != nil {
		return nil, err
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

	for _, warning := range cfg.Warnings {
		logger.Warn(warning)
	}
	// Emails go out after the response, so asking for a code never waits on the mail server.
	background := auth.WithBackgroundMail(logger)
	authOptions := []auth.Option{background}
	if cfg.ReviewEmail != "" {
		authOptions = append(authOptions, auth.WithReviewAccount(cfg.ReviewEmail, cfg.ReviewCode, cfg.ReviewUntil))
		if time.Now().Before(cfg.ReviewUntil) {
			logger.Info("review account sign in is on", "until", cfg.ReviewUntil.Format(time.DateOnly))
		}
	}
	authService, err := auth.NewService(auth.NewPostgresStore(pool), mailer, cfg.AuthSecret, site.EmailDomains, authOptions...)
	if err != nil && len(authOptions) > 1 {
		// Only the review account can make this fail with options, say an address outside the school domains.
		logger.Warn("review sign in is off", "error", err)
		authService, err = auth.NewService(auth.NewPostgresStore(pool), mailer, cfg.AuthSecret, site.EmailDomains, background)
	}
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
	socialService.SetNotify(func(kind, senderID string, userIDs []string, title, body, path string) {
		go pushService.Notify(context.Background(), senderID, userIDs, push.Message{Kind: kind, Title: title, Body: body, URL: path})
	})

	api := httpapi.New(cfg, logger, site, authService, socialService, pushService, settings.NewService(pool), issues.NewService(pool, site), human)
	return &App{
		Handler: api.Handler(),
		Config:  cfg,
		Jobs:    []func(context.Context) error{authService.Cleanup, socialService.Cleanup},
		Close: func() {
			authService.Wait()
			pool.Close()
		},
		api: api,
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

// In production a token must come from one of our own sites; development runs on Cloudflare's test keys,
// which answer for example.com.
func humanCheck(cfg config.Config) (*turnstile.Verifier, error) {
	var hostnames []string
	if cfg.IsProduction() {
		for origin := range cfg.AllowedOrigins {
			if u, err := url.Parse(origin); err == nil && u.Hostname() != "" {
				hostnames = append(hostnames, u.Hostname())
			}
		}
	}
	// An empty list relaxes the checks for test keys, so production must never end up with one.
	if cfg.IsProduction() && len(hostnames) == 0 {
		return nil, fmt.Errorf("turnstile: no hostnames from ALLOWED_ORIGINS")
	}
	return turnstile.New(cfg.TurnstileSecret, hostnames, ""), nil
}
