package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

const secret = "TXQ2rk8fvJm3pBw9dLc6ZaNyHs4Ugt7E"

func call(t *testing.T, h http.Handler, method, authorization string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/v1/maintenance", nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	return res
}

func TestMaintenanceRunsOnlyForTheScheduler(t *testing.T) {
	ran := 0
	jobs := []func(context.Context) error{func(context.Context) error { ran++; return nil }}

	h := Maintenance(secret, jobs, quietLogger())
	if got := call(t, h, http.MethodGet, "Bearer "+secret).Code; got != http.StatusNoContent {
		t.Fatalf("the scheduler should be allowed through, got %d", got)
	}
	if ran != 1 {
		t.Fatalf("jobs ran %d times", ran)
	}

	refused := map[string]string{
		"no header":     "",
		"wrong secret":  "Bearer " + secret[:len(secret)-1] + "X",
		"empty bearer":  "Bearer ",
		"short prefix":  "Bearer " + secret[:8],
		"wrong scheme":  "Basic " + secret,
		"just the word": secret,
	}
	for name, header := range refused {
		t.Run(name, func(t *testing.T) {
			before := ran
			if got := call(t, h, http.MethodGet, header).Code; got != http.StatusNotFound {
				t.Fatalf("%s should look like an unknown path, got %d", name, got)
			}
			if ran != before {
				t.Fatal("jobs ran for a request that was not allowed")
			}
		})
	}
}

// Without a secret the route must not exist at all, so a forgotten setting cannot expose it.
func TestMaintenanceIsOffWithoutASecret(t *testing.T) {
	ran := false
	h := Maintenance("", []func(context.Context) error{func(context.Context) error { ran = true; return nil }}, quietLogger())

	for _, header := range []string{"", "Bearer ", "Bearer anything"} {
		if got := call(t, h, http.MethodGet, header).Code; got != http.StatusNotFound {
			t.Fatalf("header %q returned %d, want 404", header, got)
		}
	}
	if ran {
		t.Fatal("jobs ran while maintenance was off")
	}
}

func TestMaintenanceRejectsOtherMethods(t *testing.T) {
	h := Maintenance(secret, nil, quietLogger())
	if got := call(t, h, http.MethodDelete, "Bearer "+secret).Code; got != http.StatusMethodNotAllowed {
		t.Fatalf("delete returned %d", got)
	}
}

func TestMaintenanceReportsAFailedJob(t *testing.T) {
	second := false
	jobs := []func(context.Context) error{
		func(context.Context) error { return errors.New("database is down") },
		func(context.Context) error { second = true; return nil },
	}
	res := call(t, Maintenance(secret, jobs, quietLogger()), http.MethodPost, "Bearer "+secret)
	if res.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", res.Code)
	}
	if second {
		t.Fatal("later jobs should not run after a failure")
	}
	if body := res.Body.String(); len(body) > 0 && body != "cleanup failed\n" {
		t.Fatalf("the reason must stay out of the response: %q", body)
	}
}
