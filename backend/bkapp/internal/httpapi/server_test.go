package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/auth/authtest"
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/config"
)

const (
	appOrigin = "http://localhost:3000"
	student   = "jane.doe12@stu-mail.csi.cuny.edu"
)

type testEnv struct {
	handler http.Handler
	mail    *authtest.CapturedMail
}

func newTestEnv(t *testing.T) testEnv {
	t.Helper()
	site, err := campus.Load()
	if err != nil {
		t.Fatalf("load campus: %v", err)
	}
	cfg := config.Config{
		Port:           8080,
		Env:            "development",
		AllowedOrigins: map[string]struct{}{appOrigin: {}},
	}
	mail := &authtest.CapturedMail{}
	svc, err := auth.NewService(authtest.NewMemoryStore(time.Now), mail, []byte(strings.Repeat("k", 40)), site.EmailDomains)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return testEnv{handler: New(cfg, logger, site, svc, nil, nil, nil).Handler(), mail: mail}
}

func jsonRequest(method, path, body string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", appOrigin)
	return req
}

func serve(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestPushConfigOffWhenKeysMissing(t *testing.T) {
	env := newTestEnv(t)
	rec := serve(env.handler, httptest.NewRequest(http.MethodGet, "/v1/push/config", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Available bool   `json:"available"`
		PublicKey string `json:"publicKey"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Available || body.PublicKey != "" {
		t.Fatalf("push should be off without VAPID keys: %+v", body)
	}
}

func TestPlacesEndpoint(t *testing.T) {
	env := newTestEnv(t)
	rec := serve(env.handler, httptest.NewRequest(http.MethodGet, "/v1/places", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing security headers")
	}
	var body struct {
		Places []campus.Place `json:"places"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || len(body.Places) == 0 {
		t.Fatalf("bad body: %v", err)
	}
}

func TestUnknownRouteAndMethod(t *testing.T) {
	env := newTestEnv(t)
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/nope"},
		{http.MethodPost, "/v1/places"},
		{http.MethodGet, "/v1/auth/code"},
	} {
		rec := serve(env.handler, jsonRequest(tc.method, tc.path, "{}"))
		if rec.Code < 400 {
			t.Errorf("%s %s returned %d", tc.method, tc.path, rec.Code)
		}
	}
}

func TestWritesNeedAllowedOrigin(t *testing.T) {
	env := newTestEnv(t)
	for _, origin := range []string{"", "https://evil.example", "null"} {
		req := jsonRequest(http.MethodPost, "/v1/auth/code", `{"email":"`+student+`"}`)
		if origin == "" {
			req.Header.Del("Origin")
		} else {
			req.Header.Set("Origin", origin)
		}
		rec := serve(env.handler, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("origin %q: status = %d, want 403", origin, rec.Code)
		}
		if rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("origin %q must not get CORS headers", origin)
		}
	}
	if env.mail.Last(student) != "" {
		t.Fatal("no code should be sent for rejected origins")
	}
}

func TestPreflight(t *testing.T) {
	env := newTestEnv(t)

	req := httptest.NewRequest(http.MethodOptions, "/v1/auth/code", nil)
	req.Header.Set("Origin", appOrigin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	rec := serve(env.handler, req)
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != appOrigin || rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("allowed preflight: %d %v", rec.Code, rec.Header())
	}

	req.Header.Set("Origin", "https://evil.example")
	if rec := serve(env.handler, req); rec.Code != http.StatusForbidden {
		t.Fatalf("disallowed preflight status = %d", rec.Code)
	}
}

func TestRejectsBadBodies(t *testing.T) {
	env := newTestEnv(t)
	cases := []struct {
		name, contentType, body string
		want                    int
	}{
		{"wrong content type", "text/plain", `{"email":"` + student + `"}`, http.StatusUnsupportedMediaType},
		{"unknown field", "application/json", `{"email":"` + student + `","admin":true}`, http.StatusBadRequest},
		{"two objects", "application/json", `{"email":"a"}{"email":"b"}`, http.StatusBadRequest},
		{"too large", "application/json", `{"email":"` + strings.Repeat("a", 4000) + `"}`, http.StatusBadRequest},
		{"other domain", "application/json", `{"email":"jane@gmail.com"}`, http.StatusAccepted},
	}
	for _, tc := range cases {
		req := jsonRequest(http.MethodPost, "/v1/auth/code", tc.body)
		req.Header.Set("Content-Type", tc.contentType)
		if rec := serve(env.handler, req); rec.Code != tc.want {
			t.Errorf("%s: status = %d, want %d", tc.name, rec.Code, tc.want)
		}
	}
}

func TestSignInOverHTTP(t *testing.T) {
	env := newTestEnv(t)
	srv := httptest.NewServer(env.handler)
	defer srv.Close()

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	call := func(method, path, body string) (*http.Response, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", appOrigin)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var payload map[string]any
		_ = json.NewDecoder(res.Body).Decode(&payload)
		return res, payload
	}

	if res, _ := call(http.MethodGet, "/v1/me", ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("me before sign in = %d", res.StatusCode)
	}

	if res, _ := call(http.MethodPost, "/v1/auth/code", `{"email":"`+student+`"}`); res.StatusCode != http.StatusAccepted {
		t.Fatalf("request code = %d", res.StatusCode)
	}
	if res, _ := call(http.MethodPost, "/v1/auth/code", `{"email":"`+student+`"}`); res.StatusCode != http.StatusTooManyRequests || res.Header.Get("Retry-After") == "" {
		t.Fatalf("second code request = %d", res.StatusCode)
	}

	if res, _ := call(http.MethodPost, "/v1/auth/verify", `{"email":"`+student+`","code":"abc"}`); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad code = %d", res.StatusCode)
	}

	res, body := call(http.MethodPost, "/v1/auth/verify", `{"email":"`+student+`","code":"`+env.mail.Last(student)+`"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("verify = %d", res.StatusCode)
	}
	var session *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == "session" {
			session = c
		}
	}
	if session == nil || !session.HttpOnly || session.SameSite != http.SameSiteStrictMode || session.Value == "" {
		t.Fatalf("session cookie not set safely: %+v", session)
	}
	user, _ := body["user"].(map[string]any)
	if user["email"] != student || user["needsProfile"] != true || len(user) != 4 {
		t.Fatalf("unexpected user payload: %v", body)
	}

	if res, body := call(http.MethodPatch, "/v1/me", `{"displayName":"Jane D","username":"jane_on_campus"}`); res.StatusCode != http.StatusOK ||
		body["user"].(map[string]any)["username"] != "jane_on_campus" || body["user"].(map[string]any)["needsProfile"] != false {
		t.Fatalf("update profile = %d %v", res.StatusCode, body)
	}
	for body, want := range map[string]int{
		`{"displayName":"<b>x</b>"}`:  http.StatusBadRequest,
		`{"username":"janedoe12"}`:    http.StatusBadRequest,
		`{"username":"admin"}`:        http.StatusConflict,
		`{}`:                          http.StatusBadRequest,
		`{"email":"new@example.com"}`: http.StatusBadRequest,
	} {
		if res, _ := call(http.MethodPatch, "/v1/me", body); res.StatusCode != want {
			t.Errorf("PATCH %s = %d, want %d", body, res.StatusCode, want)
		}
	}

	if res, _ := call(http.MethodPost, "/v1/auth/signout", ""); res.StatusCode != http.StatusNoContent {
		t.Fatalf("sign out = %d", res.StatusCode)
	}
	if res, _ := call(http.MethodGet, "/v1/me", ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("me after sign out = %d", res.StatusCode)
	}

	u, _ := url.Parse(srv.URL)
	jar.SetCookies(u, []*http.Cookie{{Name: "session", Value: session.Value, Path: "/"}})
	if res, _ := call(http.MethodGet, "/v1/me", ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("old token after sign out = %d", res.StatusCode)
	}
}

func TestRateLimiter(t *testing.T) {
	now := time.Unix(0, 0)
	rl := newRateLimiter(2, time.Minute)
	rl.now = func() time.Time { return now }

	if !rl.allow("a") || !rl.allow("a") {
		t.Fatal("first two requests should pass")
	}
	if rl.allow("a") {
		t.Fatal("third request should be limited")
	}
	if !rl.allow("b") {
		t.Fatal("other clients should not be affected")
	}

	now = now.Add(time.Minute)
	if !rl.allow("a") {
		t.Fatal("limit should reset after the window")
	}
}

func TestSignOutEverywhereOverHTTP(t *testing.T) {
	env := newTestEnv(t)
	srv := httptest.NewServer(env.handler)
	defer srv.Close()

	signIn := func() *http.Client {
		jar, _ := cookiejar.New(nil)
		client := &http.Client{Jar: jar}
		post := func(path, body string) *http.Response {
			req, _ := http.NewRequest(http.MethodPost, srv.URL+path, strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Origin", appOrigin)
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			return res
		}
		if res := post("/v1/auth/code", `{"email":"`+student+`"}`); res.StatusCode != http.StatusAccepted {
			t.Fatalf("code = %d", res.StatusCode)
		}
		if res := post("/v1/auth/verify", `{"email":"`+student+`","code":"`+env.mail.Last(student)+`"}`); res.StatusCode != http.StatusOK {
			t.Fatalf("verify = %d", res.StatusCode)
		}
		return client
	}
	me := func(client *http.Client) int {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/v1/me", nil)
		req.Header.Set("Origin", appOrigin)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}

	laptop := signIn()
	if me(laptop) != http.StatusOK {
		t.Fatal("laptop should be signed in")
	}

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/auth/signout-all", nil)
	req.Header.Set("Origin", appOrigin)
	res, err := laptop.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("signout-all = %d", res.StatusCode)
	}
	if me(laptop) != http.StatusUnauthorized {
		t.Fatal("session must end everywhere")
	}
}

func TestDeleteAccountOverHTTP(t *testing.T) {
	env := newTestEnv(t)
	srv := httptest.NewServer(env.handler)
	defer srv.Close()

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	post := func(path, body string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, srv.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", appOrigin)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res
	}
	if res := post("/v1/auth/code", `{"email":"`+student+`"}`); res.StatusCode != http.StatusAccepted {
		t.Fatalf("code = %d", res.StatusCode)
	}
	if res := post("/v1/auth/verify", `{"email":"`+student+`","code":"`+env.mail.Last(student)+`"}`); res.StatusCode != http.StatusOK {
		t.Fatalf("verify = %d", res.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/v1/me", nil)
	req.Header.Set("Origin", "https://evil.example")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin delete = %d", res.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodDelete, srv.URL+"/v1/me", nil)
	req.Header.Set("Origin", appOrigin)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete = %d", res.StatusCode)
	}

	req, _ = http.NewRequest(http.MethodGet, srv.URL+"/v1/me", nil)
	req.Header.Set("Origin", appOrigin)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatal("session must end after delete")
	}
}

func TestExportAccountOverHTTP(t *testing.T) {
	env := newTestEnv(t)
	srv := httptest.NewServer(env.handler)
	defer srv.Close()

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	post := func(path, body string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, srv.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", appOrigin)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res
	}
	if res := post("/v1/auth/code", `{"email":"`+student+`"}`); res.StatusCode != http.StatusAccepted {
		t.Fatalf("code = %d", res.StatusCode)
	}
	if res := post("/v1/auth/verify", `{"email":"`+student+`","code":"`+env.mail.Last(student)+`"}`); res.StatusCode != http.StatusOK {
		t.Fatalf("verify = %d", res.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/v1/me/export", nil)
	req.Header.Set("Origin", appOrigin)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("export = %d", res.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	account, _ := payload["account"].(map[string]any)
	if account["email"] != student {
		t.Fatalf("export must include the owner's email: %v", payload)
	}
	if _, ok := payload["friends"]; !ok {
		t.Fatal("export missing friends")
	}
	if _, ok := payload["meetups"]; !ok {
		t.Fatal("export missing meetups")
	}
	if notes, _ := payload["notStored"].([]any); len(notes) == 0 {
		t.Fatal("export should say what is never stored")
	}
}

func TestClientIPUsesLastProxyEntry(t *testing.T) {
	ip := clientIPFunc("X-Forwarded-For")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 203.0.113.9")
	if got := ip(req); got != "203.0.113.9" {
		t.Fatalf("got %s, want the proxy-written entry", got)
	}
}

// The phone app signs in without cookies: it gets its token once from the app verify route and sends it as a
// bearer token, marking every request with its client header.
func TestPhoneAppSignIn(t *testing.T) {
	env := newTestEnv(t)
	srv := httptest.NewServer(env.handler)
	defer srv.Close()

	call := func(method, path, body string, headers map[string]string) (*http.Response, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var payload map[string]any
		_ = json.NewDecoder(res.Body).Decode(&payload)
		return res, payload
	}
	app := map[string]string{"X-CSIMap-Client": "app"}

	if res, _ := call(http.MethodPost, "/v1/auth/code", `{"email":"`+student+`"}`, app); res.StatusCode != http.StatusAccepted {
		t.Fatalf("app code request = %d", res.StatusCode)
	}
	code := env.mail.Last(student)

	// A web page always sends Origin, so it can never read a session token from this route.
	if res, _ := call(http.MethodPost, "/v1/app/auth/verify", `{"email":"`+student+`","code":"`+code+`"}`,
		map[string]string{"X-CSIMap-Client": "app", "Origin": appOrigin}); res.StatusCode != http.StatusForbidden {
		t.Fatalf("app verify from a browser = %d", res.StatusCode)
	}
	if res, _ := call(http.MethodPost, "/v1/app/auth/verify", `{"email":"`+student+`","code":"`+code+`"}`, nil); res.StatusCode != http.StatusForbidden {
		t.Fatalf("app verify without the header = %d", res.StatusCode)
	}

	res, body := call(http.MethodPost, "/v1/app/auth/verify", `{"email":"`+student+`","code":"`+code+`"}`, app)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("app verify = %d %v", res.StatusCode, body)
	}
	if len(res.Cookies()) != 0 {
		t.Fatal("the app route must not set a cookie")
	}
	token, _ := body["token"].(string)
	user, _ := body["user"].(map[string]any)
	if token == "" || user["email"] != student || len(user) != 4 {
		t.Fatalf("unexpected app verify payload: %v", body)
	}

	bearer := map[string]string{"X-CSIMap-Client": "app", "Authorization": "Bearer " + token}
	if res, _ := call(http.MethodGet, "/v1/me", "", bearer); res.StatusCode != http.StatusOK {
		t.Fatalf("me with bearer = %d", res.StatusCode)
	}
	if res, body := call(http.MethodPatch, "/v1/me", `{"displayName":"Jane D","username":"jane_on_phone"}`, bearer); res.StatusCode != http.StatusOK {
		t.Fatalf("profile from app = %d %v", res.StatusCode, body)
	}
	foreign := map[string]string{"X-CSIMap-Client": "app", "Authorization": "Bearer " + token, "Origin": "https://evil.example"}
	if res, _ := call(http.MethodPatch, "/v1/me", `{"displayName":"Mallory"}`, foreign); res.StatusCode != http.StatusForbidden {
		t.Fatalf("write from a foreign page with the header = %d", res.StatusCode)
	}
	for _, header := range []string{"Bearer", "Bearer ", "Basic " + token, "Bearer not-a-token"} {
		if res, _ := call(http.MethodGet, "/v1/me", "", map[string]string{"Authorization": header}); res.StatusCode != http.StatusUnauthorized {
			t.Errorf("Authorization %q = %d", header, res.StatusCode)
		}
	}

	if res, _ := call(http.MethodPost, "/v1/auth/signout", "", bearer); res.StatusCode != http.StatusNoContent {
		t.Fatalf("app sign out = %d", res.StatusCode)
	}
	if res, _ := call(http.MethodGet, "/v1/me", "", bearer); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("token after sign out = %d", res.StatusCode)
	}
}
