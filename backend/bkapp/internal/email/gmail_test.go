package email

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newTestGmail(t *testing.T, tokenURL, sendURL string) *Gmail {
	t.Helper()
	g, err := NewGmail("id.apps.googleusercontent.com", "GOCSPX-secret", "1//refresh", "CSI Map <codes@gmail.com>", testRenderer(t))
	if err != nil {
		t.Fatalf("new gmail: %v", err)
	}
	g.tokenURL = tokenURL
	g.sendURL = sendURL
	return g
}

func TestGmailSendsRawMessageAndReusesToken(t *testing.T) {
	var tokenCalls, sendCalls atomic.Int32
	token := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenCalls.Add(1)
		if err := r.ParseForm(); err != nil || r.PostForm.Get("grant_type") != "refresh_token" || r.PostForm.Get("refresh_token") != "1//refresh" {
			t.Errorf("unexpected token request: %v", r.PostForm)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"at-1","expires_in":3600}`))
	}))
	defer token.Close()

	var raw string
	send := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sendCalls.Add(1)
		if got := r.Header.Get("Authorization"); got != "Bearer at-1" {
			t.Errorf("authorization = %q", got)
		}
		var body struct {
			Raw string `json:"raw"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode: %v", err)
		}
		raw = body.Raw
		w.WriteHeader(http.StatusOK)
	}))
	defer send.Close()

	g := newTestGmail(t, token.URL, send.URL)
	for i := 0; i < 2; i++ {
		if err := g.SendLoginCode(context.Background(), "student@cix.csi.cuny.edu", "12345678"); err != nil {
			t.Fatalf("send: %v", err)
		}
	}

	if tokenCalls.Load() != 1 {
		t.Errorf("token requests = %d, want the cached token to be reused", tokenCalls.Load())
	}
	if sendCalls.Load() != 2 {
		t.Errorf("send requests = %d", sendCalls.Load())
	}

	decoded, err := base64.URLEncoding.DecodeString(raw)
	if err != nil {
		t.Fatalf("raw is not base64url: %v", err)
	}
	message := string(decoded)
	for _, want := range []string{"To: <student@cix.csi.cuny.edu>", "From: \"CSI Map\" <codes@gmail.com>", "multipart/alternative"} {
		if !strings.Contains(message, want) {
			t.Errorf("message is missing %q", want)
		}
	}
	if strings.Contains(raw, "+") || strings.Contains(raw, "/") {
		t.Error("raw must use the url safe alphabet")
	}
}

func TestGmailRefreshesOnceAfterUnauthorized(t *testing.T) {
	var tokenCalls atomic.Int32
	token := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		count := tokenCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if count == 1 {
			_, _ = w.Write([]byte(`{"access_token":"stale","expires_in":3600}`))
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"fresh","expires_in":3600}`))
	}))
	defer token.Close()

	send := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer stale" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer send.Close()

	g := newTestGmail(t, token.URL, send.URL)
	if err := g.SendLoginCode(context.Background(), "student@cix.csi.cuny.edu", "12345678"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if tokenCalls.Load() != 2 {
		t.Errorf("token requests = %d, want one refresh after the 401", tokenCalls.Load())
	}
}

func TestGmailErrorsKeepCredentialsOut(t *testing.T) {
	token := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","refresh_token":"1//refresh"}`))
	}))
	defer token.Close()
	send := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	defer send.Close()

	g := newTestGmail(t, token.URL, send.URL)
	err := g.SendLoginCode(context.Background(), "student@cix.csi.cuny.edu", "12345678")
	if err == nil {
		t.Fatal("want an error when google refuses the refresh token")
	}
	for _, secret := range []string{"1//refresh", "GOCSPX-secret"} {
		if strings.Contains(err.Error(), secret) {
			t.Errorf("error leaks %q: %v", secret, err)
		}
	}
}

func TestGmailRefreshesExpiredToken(t *testing.T) {
	var tokenCalls atomic.Int32
	token := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		tokenCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"at","expires_in":3600}`))
	}))
	defer token.Close()
	send := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	defer send.Close()

	g := newTestGmail(t, token.URL, send.URL)
	clock := time.Now()
	g.now = func() time.Time { return clock }

	if err := g.SendLoginCode(context.Background(), "student@cix.csi.cuny.edu", "12345678"); err != nil {
		t.Fatalf("send: %v", err)
	}
	clock = clock.Add(2 * time.Hour)
	if err := g.SendLoginCode(context.Background(), "student@cix.csi.cuny.edu", "12345678"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if tokenCalls.Load() != 2 {
		t.Errorf("token requests = %d, want a new token once the old one expired", tokenCalls.Load())
	}
}

func TestGmailRejectsHeaderInjection(t *testing.T) {
	g := newTestGmail(t, "http://127.0.0.1:1", "http://127.0.0.1:1")
	if err := g.SendLoginCode(context.Background(), "student@cix.csi.cuny.edu\r\nBcc: attacker@example.com", "12345678"); err == nil {
		t.Fatal("want an error for a recipient with a line break")
	}
}
