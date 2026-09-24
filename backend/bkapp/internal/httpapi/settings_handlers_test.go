package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/auth/authtest"
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/settings"
)

// The requests here are all turned away before the database is reached, so the service needs none.
func settingsServer(t *testing.T) (*httptest.Server, *authtest.CapturedMail) {
	t.Helper()
	site, err := campus.Load()
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Port: 8080, Env: "development", AllowedOrigins: map[string]struct{}{appOrigin: {}}}
	mail := &authtest.CapturedMail{}
	svc, err := auth.NewService(authtest.NewMemoryStore(time.Now), mail, []byte(strings.Repeat("k", 40)), site.EmailDomains)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := httptest.NewServer(New(cfg, logger, site, svc, nil, nil, settings.NewService(nil)).Handler())
	t.Cleanup(srv.Close)
	return srv, mail
}

func settingsCall(t *testing.T, client *http.Client, method, url, body string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", appOrigin)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	text, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(text)
}

func TestSettingsNeedSignIn(t *testing.T) {
	srv, _ := settingsServer(t)
	client := &http.Client{}
	if status, _ := settingsCall(t, client, http.MethodGet, srv.URL+"/v1/me/settings", ""); status != http.StatusUnauthorized {
		t.Fatalf("read while signed out = %d", status)
	}
	if status, _ := settingsCall(t, client, http.MethodPatch, srv.URL+"/v1/me/settings", `{"voice":"af_heart"}`); status != http.StatusUnauthorized {
		t.Fatalf("write while signed out = %d", status)
	}
}

func TestSettingsRefuseBadInput(t *testing.T) {
	srv, mail := settingsServer(t)
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	if status, _ := settingsCall(t, client, http.MethodPost, srv.URL+"/v1/auth/code", `{"email":"`+student+`"}`); status != http.StatusAccepted {
		t.Fatalf("code = %d", status)
	}
	if status, _ := settingsCall(t, client, http.MethodPost, srv.URL+"/v1/auth/verify", `{"email":"`+student+`","code":"`+mail.Last(student)+`"}`); status != http.StatusOK {
		t.Fatalf("verify = %d", status)
	}

	cases := map[string]string{
		"a voice that is not offered":   `{"voice":"am_adam"}`,
		"something that is not a voice": `{"voice":"'; drop table users; --"}`,
		"an extra field":                `{"voice":"af_heart","admin":true}`,
		"no voice at all":               `{}`,
		"a voice that is not a string":  `{"voice":42}`,
	}
	for name, body := range cases {
		status, text := settingsCall(t, client, http.MethodPatch, srv.URL+"/v1/me/settings", body)
		if status != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400 (%s)", name, status, text)
		}
		if strings.Contains(text, "drop table") {
			t.Errorf("%s: the response echoes the input: %s", name, text)
		}
	}
}

func TestSettingsWritesNeedAllowedOrigin(t *testing.T) {
	srv, _ := settingsServer(t)
	req, _ := http.NewRequest(http.MethodPatch, srv.URL+"/v1/me/settings", strings.NewReader(`{"voice":"af_heart"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("write from another site = %d, want 403", res.StatusCode)
	}
}

func TestVoiceList(t *testing.T) {
	for _, voice := range []string{"", "device", "af_heart", "bm_george"} {
		if !settings.ValidVoice(voice) {
			t.Errorf("%q should be accepted", voice)
		}
	}
	for _, voice := range []string{"af_adam", "AF_HEART", "af_heart ", "../voices/af_heart", "af_heart\x00"} {
		if settings.ValidVoice(voice) {
			t.Errorf("%q should be refused", voice)
		}
	}
}
