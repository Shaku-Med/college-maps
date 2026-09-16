package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// CodeMinutes matches auth.CodeTTL; it only feeds the wording of the email.
const CodeMinutes = 10

type Sender interface {
	SendLoginCode(ctx context.Context, to, code string) error
}

const resendEndpoint = "https://api.resend.com/emails"

type Resend struct {
	apiKey   string
	from     string
	renderer *Renderer
	client   *http.Client
}

func NewResend(apiKey, from string, renderer *Renderer) *Resend {
	return &Resend{apiKey: apiKey, from: from, renderer: renderer, client: &http.Client{Timeout: 10 * time.Second}}
}

func (r *Resend) SendLoginCode(ctx context.Context, to, code string) error {
	msg, err := r.renderer.LoginCode(to, code, CodeMinutes, r.renderer.LogoURL())
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]any{
		"from":    r.from,
		"to":      []string{to},
		"subject": msg.Subject,
		"text":    msg.Text,
		"html":    msg.HTML,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+r.apiKey)
	req.Header.Set("Content-Type", "application/json")

	res, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
	if res.StatusCode >= 300 {
		return fmt.Errorf("send email: resend returned %d", res.StatusCode)
	}
	return nil
}

// Log prints codes instead of emailing them. Config only allows it when APP_ENV=development.
type Log struct {
	logger *slog.Logger
}

func NewLog(logger *slog.Logger) *Log {
	return &Log{logger: logger}
}

func (l *Log) SendLoginCode(_ context.Context, to, code string) error {
	l.logger.Warn("development sign-in code, not emailed", "to", to, "code", code)
	return nil
}
