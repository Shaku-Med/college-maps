package email

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Gmail sends the same message as the SMTP sender, but over https instead of an SMTP port. Hosts
// like Render's free plan block outbound 25, 465 and 587, so smtp mode times out there while this
// keeps working. It acts as one Gmail account through an OAuth refresh token; cmd/gmailtoken
// creates that token.
const (
	googleTokenURL = "https://oauth2.googleapis.com/token"
	gmailSendURL   = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
	// GmailScope lets the app send mail and nothing else. It cannot read the mailbox.
	GmailScope = "https://www.googleapis.com/auth/gmail.send"

	gmailTimeout = 15 * time.Second
	tokenSkew    = time.Minute
)

type Gmail struct {
	clientID     string
	clientSecret string
	refreshToken string
	from         *mail.Address
	renderer     *Renderer
	client       *http.Client
	tokenURL     string
	sendURL      string
	now          func() time.Time

	mu      sync.Mutex
	token   string
	expires time.Time
}

func NewGmail(clientID, clientSecret, refreshToken, from string, renderer *Renderer) (*Gmail, error) {
	sender, err := mail.ParseAddress(from)
	if err != nil {
		return nil, fmt.Errorf("parse EMAIL_FROM: %w", err)
	}
	if clientID == "" || clientSecret == "" || refreshToken == "" {
		return nil, errors.New("gmail needs a client id, a client secret and a refresh token")
	}
	return &Gmail{
		clientID:     clientID,
		clientSecret: clientSecret,
		refreshToken: refreshToken,
		from:         sender,
		renderer:     renderer,
		client:       &http.Client{Timeout: gmailTimeout},
		tokenURL:     googleTokenURL,
		sendURL:      gmailSendURL,
		now:          time.Now,
	}, nil
}

func (g *Gmail) SendLoginCode(ctx context.Context, to, code string) error {
	if strings.ContainsAny(to, "\r\n") {
		return errors.New("send email: invalid recipient")
	}
	msg, err := g.renderer.LoginCode(to, code, CodeMinutes, "cid:"+LogoContentID)
	if err != nil {
		return err
	}
	body, err := buildMessage(g.from, to, msg, Logo, g.now())
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]string{"raw": base64.URLEncoding.EncodeToString(body)})
	if err != nil {
		return err
	}

	status, err := g.post(ctx, payload, false)
	// A cached access token can stop working early, so one refresh and retry before giving up.
	if err == nil && status == http.StatusUnauthorized {
		status, err = g.post(ctx, payload, true)
	}
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	if status >= 300 {
		return fmt.Errorf("send email: gmail returned %d", status)
	}
	return nil
}

func (g *Gmail) post(ctx context.Context, payload []byte, refresh bool) (int, error) {
	token, err := g.accessToken(ctx, refresh)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.sendURL, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	res, err := g.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
	return res.StatusCode, nil
}

// accessToken trades the long lived refresh token for a short lived access token and keeps it until
// it is nearly expired. The lock also stops a burst of sign ins from asking Google all at once.
func (g *Gmail) accessToken(ctx context.Context, refresh bool) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if !refresh && g.token != "" && g.now().Before(g.expires) {
		return g.token, nil
	}

	form := url.Values{
		"client_id":     {g.clientID},
		"client_secret": {g.clientSecret},
		"refresh_token": {g.refreshToken},
		"grant_type":    {"refresh_token"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := g.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return "", err
	}
	if res.StatusCode >= 300 {
		// The reply can quote the credentials back, so only the status code is reported.
		return "", fmt.Errorf("google refused the gmail refresh token (%d), run cmd/gmailtoken again", res.StatusCode)
	}

	var parsed struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil || parsed.AccessToken == "" {
		return "", errors.New("google returned no access token")
	}

	g.token = parsed.AccessToken
	life := time.Duration(parsed.ExpiresIn)*time.Second - tokenSkew
	if life < 0 {
		life = 0
	}
	g.expires = g.now().Add(life)
	return g.token, nil
}
