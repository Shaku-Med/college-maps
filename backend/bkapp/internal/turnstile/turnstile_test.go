package turnstile

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func fakeCloudflare(t *testing.T, answer reply, status int) (*httptest.Server, *[]string) {
	t.Helper()
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form: %v", err)
		}
		seen = append(seen, r.PostForm.Get("secret")+"|"+r.PostForm.Get("response")+"|"+r.PostForm.Get("remoteip"))
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(answer)
	}))
	t.Cleanup(srv.Close)
	return srv, &seen
}

func TestVerify(t *testing.T) {
	good := reply{Success: true, Hostname: "csimap.app", Action: "signin"}
	cases := map[string]struct {
		answer reply
		status int
		token  string
		ok     bool
	}{
		"good token":           {good, http.StatusOK, "tok", true},
		"hostname any case":    {reply{Success: true, Hostname: "CSIMAP.app", Action: "signin"}, http.StatusOK, "tok", true},
		"cloudflare says no":   {reply{Success: false, Errors: []string{"timeout-or-duplicate"}}, http.StatusOK, "tok", false},
		"other site":           {reply{Success: true, Hostname: "evil.example", Action: "signin"}, http.StatusOK, "tok", false},
		"other action":         {reply{Success: true, Hostname: "csimap.app", Action: "comment"}, http.StatusOK, "tok", false},
		"blank action":         {reply{Success: true, Hostname: "csimap.app"}, http.StatusOK, "tok", false},
		"cloudflare is broken": {good, http.StatusInternalServerError, "tok", false},
		"empty token":          {good, http.StatusOK, "", false},
		"oversized token":      {good, http.StatusOK, strings.Repeat("a", MaxTokenLength+1), false},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			srv, _ := fakeCloudflare(t, tc.answer, tc.status)
			v := New("secret", []string{"csimap.app"}, srv.URL)
			err := v.Verify(context.Background(), tc.token, "signin", "203.0.113.9")
			if (err == nil) != tc.ok {
				t.Fatalf("Verify() error = %v, want ok %v", err, tc.ok)
			}
		})
	}
}

func TestVerifySendsSecretTokenAndIP(t *testing.T) {
	srv, seen := fakeCloudflare(t, reply{Success: true, Hostname: "csimap.app", Action: "signin"}, http.StatusOK)
	if err := New("s3cret", []string{"csimap.app"}, srv.URL).Verify(context.Background(), "tok", "signin", "203.0.113.9"); err != nil {
		t.Fatal(err)
	}
	if len(*seen) != 1 || (*seen)[0] != "s3cret|tok|203.0.113.9" {
		t.Fatalf("cloudflare saw %q", *seen)
	}
}

func TestEmptyTokenNeverCallsCloudflare(t *testing.T) {
	srv, seen := fakeCloudflare(t, reply{Success: true}, http.StatusOK)
	err := New("s", nil, srv.URL).Verify(context.Background(), "", "signin", "")
	if !errors.Is(err, ErrRejected) || len(*seen) != 0 {
		t.Fatalf("err %v, calls %d", err, len(*seen))
	}
}

func TestUnreachableCloudflareRejects(t *testing.T) {
	srv, _ := fakeCloudflare(t, reply{Success: true}, http.StatusOK)
	srv.Close()
	if err := New("s", nil, srv.URL).Verify(context.Background(), "tok", "signin", ""); err == nil {
		t.Fatal("an unreachable Cloudflare must not count as a pass")
	}
}

func TestNoHostnamesAcceptsTestKeys(t *testing.T) {
	srv, _ := fakeCloudflare(t, reply{Success: true, Hostname: "example.com"}, http.StatusOK)
	if err := New("s", nil, srv.URL).Verify(context.Background(), "tok", "signin", ""); err != nil {
		t.Fatal(err)
	}
}

func TestNoHostnamesStillChecksAGivenAction(t *testing.T) {
	srv, _ := fakeCloudflare(t, reply{Success: true, Hostname: "example.com", Action: "comment"}, http.StatusOK)
	if err := New("s", nil, srv.URL).Verify(context.Background(), "tok", "signin", ""); !errors.Is(err, ErrRejected) {
		t.Fatalf("got %v, want ErrRejected", err)
	}
}
