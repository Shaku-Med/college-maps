package httpapi

import (
	"errors"
	"net/http"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/push"
)

type pushHandlers struct {
	service *push.Service
}

func (h *pushHandlers) config(w http.ResponseWriter, _ *http.Request) {
	if h.service == nil || !h.service.Available() {
		writeJSON(w, http.StatusOK, map[string]any{"available": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": true, "publicKey": h.service.PublicKey()})
}

func (h *pushHandlers) save(w http.ResponseWriter, r *http.Request, user auth.User) {
	if h.service == nil || !h.service.Available() {
		writeError(w, http.StatusServiceUnavailable, "Notifications are not available.")
		return
	}
	var body struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	err := h.service.Save(r.Context(), user, body.Endpoint, body.Keys.P256dh, body.Keys.Auth)
	if err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *pushHandlers) remove(w http.ResponseWriter, r *http.Request, user auth.User) {
	if h.service == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var body struct {
		Endpoint string `json:"endpoint"`
		All      bool   `json:"all"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !body.All && body.Endpoint == "" {
		writeError(w, http.StatusBadRequest, "That subscription is not valid.")
		return
	}
	if err := h.service.Remove(r.Context(), user, body.Endpoint, body.All); err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// saveApp keeps the iPhone app's push token. It works whether or not Web Push is set up.
func (h *pushHandlers) saveApp(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		Token string `json:"token"`
		Badge *bool  `json:"badge"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	badge := body.Badge == nil || *body.Badge
	if err := h.service.SaveAppToken(r.Context(), user, body.Token, badge); err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *pushHandlers) removeApp(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		Token string `json:"token"`
		All   bool   `json:"all"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.service.RemoveAppToken(r.Context(), user, body.Token, body.All); err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *pushHandlers) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, push.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "Notifications are not available.")
	case errors.Is(err, push.ErrInvalid):
		writeError(w, http.StatusBadRequest, "That subscription is not valid.")
	case errors.Is(err, push.ErrTooMany):
		writeError(w, http.StatusTooManyRequests, "You've hit the limit for now. Try again later.")
	case errors.Is(err, auth.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "Sign in first.")
	default:
		writeError(w, http.StatusInternalServerError, "Something went wrong. Try again.")
	}
}
