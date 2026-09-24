package httpapi

import (
	"errors"
	"net/http"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/settings"
)

type settingsHandlers struct {
	service *settings.Service
}

func (h *settingsHandlers) get(w http.ResponseWriter, r *http.Request, user auth.User) {
	current, err := h.service.Get(r.Context(), user)
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, current)
}

func (h *settingsHandlers) save(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		Voice *string `json:"voice"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Voice == nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	saved, err := h.service.Save(r.Context(), user, settings.Settings{Voice: *body.Voice})
	if err != nil {
		h.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (h *settingsHandlers) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, settings.ErrInvalidVoice):
		writeError(w, http.StatusBadRequest, "That voice is not available.")
	case errors.Is(err, auth.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "Sign in first.")
	default:
		writeError(w, http.StatusInternalServerError, "Something went wrong. Try again.")
	}
}
