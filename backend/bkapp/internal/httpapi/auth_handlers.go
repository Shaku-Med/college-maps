package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"mime"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/push"
	"csimap/bkapp/internal/settings"
	"csimap/bkapp/internal/social"
)

const maxAuthBodyBytes = 2 << 10

type cookieSettings struct {
	name   string
	secure bool
}

// The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only, and Path=/,
// so it cannot be set by a sibling subdomain. Plain http on localhost cannot use it. SameSite=Strict
// keeps the cookie off every request that starts on another site, on top of the Origin check.
func sessionCookie(production bool) cookieSettings {
	if production {
		return cookieSettings{name: "__Host-session", secure: true}
	}
	return cookieSettings{name: "session", secure: false}
}

type authHandlers struct {
	service  *auth.Service
	social   *social.Service
	push     *push.Service
	settings *settings.Service
	logger   *slog.Logger
	cookie   cookieSettings
}

// userResponse is only ever sent to the account owner. Anything shown to other people must
// use a separate type without the email.
type userResponse struct {
	Email        string `json:"email"`
	Username     string `json:"username"`
	DisplayName  string `json:"displayName"`
	NeedsProfile bool   `json:"needsProfile"`
}

func toResponse(u auth.User) map[string]userResponse {
	return map[string]userResponse{"user": {Email: u.Email, Username: u.Username, DisplayName: u.DisplayName, NeedsProfile: u.NeedsProfile()}}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "send JSON with Content-Type: application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil || decoder.More() {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	return true
}

func (a *authHandlers) domainHint() string {
	domains := a.service.AllowedDomains()
	sort.Strings(domains)
	return "@" + strings.Join(domains, " or @")
}

func (a *authHandlers) requestCode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}

	err := a.service.RequestCode(r.Context(), body.Email)
	var limited *auth.RateLimitError
	switch {
	case err == nil:
		writeJSON(w, http.StatusAccepted, map[string]bool{"sent": true})
	case errors.Is(err, auth.ErrInvalidEmail):
		writeError(w, http.StatusBadRequest, "Enter a valid email address.")
	case errors.Is(err, auth.ErrDomainNotAllowed):
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Use your school email ending in %s.", a.domainHint()))
	case errors.As(err, &limited):
		seconds := int(math.Ceil(limited.RetryAfter.Seconds()))
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		writeError(w, http.StatusTooManyRequests, fmt.Sprintf("Please wait %d seconds before asking for another code.", seconds))
	case errors.Is(err, auth.ErrSendFailed):
		a.logger.Error("sign-in email failed", "error", err)
		writeError(w, http.StatusBadGateway, "We could not send the code. Try again in a minute.")
	default:
		a.fail(w, r, err)
	}
}

func (a *authHandlers) verifyCode(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}

	user, token, err := a.service.VerifyCode(r.Context(), body.Email, body.Code)
	var wrong *auth.WrongCodeError
	switch {
	case err == nil:
		a.setSession(w, token)
		writeJSON(w, http.StatusOK, toResponse(user))
	case errors.As(err, &wrong):
		tries := "tries"
		if wrong.AttemptsLeft == 1 {
			tries = "try"
		}
		writeError(w, http.StatusBadRequest, fmt.Sprintf("That code isn't right. You have %d %s left.", wrong.AttemptsLeft, tries))
	case errors.Is(err, auth.ErrCodeLocked):
		writeError(w, http.StatusBadRequest, "Too many wrong tries for that code. Ask for a new one.")
	case errors.Is(err, auth.ErrInvalidEmail), errors.Is(err, auth.ErrDomainNotAllowed), errors.Is(err, auth.ErrInvalidCode):
		writeError(w, http.StatusBadRequest, "That code is wrong or expired. Ask for a new one if needed.")
	default:
		a.fail(w, r, err)
	}
}

func (a *authHandlers) signOut(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(a.cookie.name); err == nil {
		if err := a.service.SignOut(r.Context(), cookie.Value); err != nil {
			a.fail(w, r, err)
			return
		}
	}
	a.clearSession(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *authHandlers) signOutEverywhere(w http.ResponseWriter, r *http.Request, user auth.User) {
	if err := a.service.SignOutEverywhere(r.Context(), user); err != nil {
		a.fail(w, r, err)
		return
	}
	a.clearSession(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *authHandlers) requireUser(next func(http.ResponseWriter, *http.Request, auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(a.cookie.name)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "not signed in")
			return
		}
		user, err := a.service.Authenticate(r.Context(), cookie.Value)
		if errors.Is(err, auth.ErrUnauthorized) {
			a.clearSession(w)
			writeError(w, http.StatusUnauthorized, "not signed in")
			return
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		next(w, r, user)
	}
}

func limitUser(rl *rateLimiter, next func(http.ResponseWriter, *http.Request, auth.User)) func(http.ResponseWriter, *http.Request, auth.User) {
	return func(w http.ResponseWriter, r *http.Request, user auth.User) {
		if !rl.allow(user.ID) {
			retry := int(rl.window.Seconds())
			if retry < 1 {
				retry = 1
			}
			w.Header().Set("Retry-After", strconv.Itoa(retry))
			writeError(w, http.StatusTooManyRequests, "Please wait a bit, then try again.")
			return
		}
		next(w, r, user)
	}
}

func (a *authHandlers) me(w http.ResponseWriter, _ *http.Request, user auth.User) {
	writeJSON(w, http.StatusOK, toResponse(user))
}

func (a *authHandlers) exportMe(w http.ResponseWriter, r *http.Request, user auth.User) {
	record, err := a.service.AccountRecord(r.Context(), user)
	if err != nil {
		a.fail(w, r, err)
		return
	}

	friends := social.Overview{Friends: []social.Friend{}, Incoming: []social.Request{}, Outgoing: []social.Request{}, Blocked: []social.Person{}}
	meetups := []social.Meetup{}
	if a.social != nil {
		friends, meetups, err = a.social.Export(r.Context(), user)
		if err != nil {
			a.fail(w, r, err)
			return
		}
	}
	notifications := []push.Subscription{}
	if a.push != nil {
		notifications, err = a.push.Export(r.Context(), user)
		if err != nil {
			a.fail(w, r, err)
			return
		}
	}

	preferences := settings.Settings{}
	if a.settings != nil {
		preferences, err = a.settings.Get(r.Context(), user)
		if err != nil {
			a.fail(w, r, err)
			return
		}
	}

	sessions := make([]map[string]string, 0, len(record.Sessions))
	for _, s := range record.Sessions {
		sessions = append(sessions, map[string]string{
			"createdAt":  s.CreatedAt.UTC().Format(time.RFC3339),
			"lastSeenAt": s.LastSeenAt.UTC().Format(time.RFC3339),
			"expiresAt":  s.ExpiresAt.UTC().Format(time.RFC3339),
		})
	}

	account := map[string]any{
		"email":       user.Email,
		"username":    user.Username,
		"displayName": user.DisplayName,
	}
	if !record.CreatedAt.IsZero() {
		account["createdAt"] = record.CreatedAt.UTC().Format(time.RFC3339)
	}
	if record.LastLoginAt != nil {
		account["lastLoginAt"] = record.LastLoginAt.UTC().Format(time.RFC3339)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"exportedAt":    time.Now().UTC().Format(time.RFC3339),
		"account":       account,
		"sessions":      sessions,
		"friends":       friends,
		"meetups":       meetups,
		"notifications": notifications,
		"settings":      preferences,
		"notStored": []string{
			"Live location is never written down. It only exists in memory during a private meetup.",
			"Your class list is saved only in this browser, and is added when you download from the app.",
		},
	})
}

func (a *authHandlers) deleteMe(w http.ResponseWriter, r *http.Request, user auth.User) {
	if err := a.service.DeleteAccount(r.Context(), user); err != nil {
		a.fail(w, r, err)
		return
	}
	a.clearSession(w)
	w.WriteHeader(http.StatusNoContent)
}

func (a *authHandlers) updateMe(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		DisplayName *string `json:"displayName"`
		Username    *string `json:"username"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	updated, err := a.service.UpdateProfile(r.Context(), user, body.DisplayName, body.Username)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, toResponse(updated))
	case errors.Is(err, auth.ErrInvalidName):
		writeError(w, http.StatusBadRequest, "Names can use 1 to 40 letters, numbers, spaces, periods, apostrophes, or dashes.")
	case errors.Is(err, auth.ErrInvalidUsername):
		writeError(w, http.StatusBadRequest, "Usernames are 3 to 20 lowercase letters, numbers, or underscores, starting with a letter or number.")
	case errors.Is(err, auth.ErrUsernameUnavailable):
		writeError(w, http.StatusConflict, "That username is not available. Try another.")
	case errors.Is(err, auth.ErrRevealsEmail):
		writeError(w, http.StatusBadRequest, "Pick something that isn't based on your school email, so it stays private.")
	case errors.Is(err, auth.ErrNothingToUpdate):
		writeError(w, http.StatusBadRequest, "Send a displayName or username to update.")
	default:
		a.fail(w, r, err)
	}
}

func (a *authHandlers) setSession(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     a.cookie.name,
		Value:    token,
		Path:     "/",
		MaxAge:   int(auth.SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   a.cookie.secure,
		SameSite: http.SameSiteStrictMode,
	})
}

func (a *authHandlers) clearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     a.cookie.name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   a.cookie.secure,
		SameSite: http.SameSiteStrictMode,
	})
}

func (a *authHandlers) fail(w http.ResponseWriter, r *http.Request, err error) {
	a.logger.Error("request failed", "path", r.URL.Path, "error", err)
	writeError(w, http.StatusInternalServerError, "Something went wrong. Try again.")
}
