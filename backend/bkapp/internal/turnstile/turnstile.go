// Package turnstile checks Cloudflare Turnstile tokens, the proof that a person and not a script asked for something.
package turnstile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	DefaultEndpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
	// Cloudflare documents tokens as at most 2048 characters.
	MaxTokenLength = 2048
	maxReplyBytes  = 16 << 10
)

var ErrRejected = errors.New("turnstile: token rejected")

type Verifier struct {
	secret    string
	endpoint  string
	hostnames map[string]struct{}
	client    *http.Client
}

// New checks tokens against Cloudflare. With no hostnames any hostname and a blank action pass, which only development
// uses, since Cloudflare's test keys answer for example.com with no action.
func New(secret string, hostnames []string, endpoint string) *Verifier {
	allowed := make(map[string]struct{}, len(hostnames))
	for _, h := range hostnames {
		allowed[strings.ToLower(h)] = struct{}{}
	}
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	return &Verifier{
		secret:    secret,
		endpoint:  endpoint,
		hostnames: allowed,
		client:    &http.Client{Timeout: 8 * time.Second},
	}
}

type reply struct {
	Success  bool     `json:"success"`
	Hostname string   `json:"hostname"`
	Action   string   `json:"action"`
	Errors   []string `json:"error-codes"`
}

// Verify passes only a fresh, unused token made on one of our sites for this action. Any doubt, including Cloudflare
// being unreachable, is a rejection.
func (v *Verifier) Verify(ctx context.Context, token, action, remoteIP string) error {
	if token == "" || len(token) > MaxTokenLength {
		return ErrRejected
	}
	form := url.Values{"secret": {v.secret}, "response": {token}}
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("turnstile: reach cloudflare: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("turnstile: cloudflare answered %d", res.StatusCode)
	}
	var out reply
	if err := json.NewDecoder(io.LimitReader(res.Body, maxReplyBytes)).Decode(&out); err != nil {
		return fmt.Errorf("turnstile: read reply: %w", err)
	}
	if !out.Success {
		return fmt.Errorf("%w: %s", ErrRejected, strings.Join(out.Errors, ","))
	}
	if out.Action != action && (len(v.hostnames) > 0 || out.Action != "") {
		return fmt.Errorf("%w: action %q", ErrRejected, out.Action)
	}
	if len(v.hostnames) > 0 {
		if _, ok := v.hostnames[strings.ToLower(out.Hostname)]; !ok {
			return fmt.Errorf("%w: hostname %q", ErrRejected, out.Hostname)
		}
	}
	return nil
}
