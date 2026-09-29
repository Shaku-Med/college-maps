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
		Voice  *string `json:"voice"`
		Notify *struct {
			FriendRequests *bool `json:"friendRequests"`
			MeetupInvites  *bool `json:"meetupInvites"`
			MeetupJoins    *bool `json:"meetupJoins"`
		} `json:"notify"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	patch := settings.Patch{Voice: body.Voice}
	if body.Notify != nil {
		patch.FriendRequests, patch.MeetupInvites, patch.MeetupJoins = body.Notify.FriendRequests, body.Notify.MeetupInvites, body.Notify.MeetupJoins
	}
	if patch == (settings.Patch{}) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	saved, err := h.service.Save(r.Context(), user, patch)
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
