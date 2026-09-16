package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// Checks that the serverless entry point builds the whole API and answers, which a plain compile
// cannot prove. Runs against a real database only when TEST_DATABASE_URL is set.
func TestHandlerServesTheAPI(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run against Postgres")
	}
	t.Setenv("APP_ENV", "development")
	t.Setenv("DATABASE_URL", url)
	t.Setenv("ALLOWED_ORIGINS", "http://localhost:3000")
	t.Setenv("AUTH_SECRET", "cWe4Rt7YuI9oP2aS5dF8gH1jK3lZ6xCv")
	t.Setenv("TICKET_SECRET", "9mNb7Vc5Xz2Lk4Jh6Gf8Ds1Aq3Wo0Pi5")
	t.Setenv("EMAIL_MODE", "log")
	t.Setenv("PORT", "")

	for _, tc := range []struct {
		path string
		want string
	}{
		{"/healthz", `"status":"ok"`},
		{"/v1/places", `"places"`},
	} {
		res := httptest.NewRecorder()
		Handler(res, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if res.Code != http.StatusOK {
			t.Fatalf("%s returned %d: %s", tc.path, res.Code, res.Body.String())
		}
		if !strings.Contains(res.Body.String(), tc.want) {
			t.Errorf("%s body = %s", tc.path, res.Body.String())
		}
	}

	// Maintenance stays shut without a scheduler secret, which this run does not set.
	res := httptest.NewRecorder()
	Handler(res, httptest.NewRequest(http.MethodGet, "/v1/maintenance", nil))
	if res.Code != http.StatusNotFound {
		t.Fatalf("maintenance returned %d without a secret", res.Code)
	}
}
