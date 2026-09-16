package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/social"
)

type socialHandlers struct {
	service *social.Service
	logger  *slog.Logger
}

func (h *socialHandlers) fail(w http.ResponseWriter, r *http.Request, err error) {
	var bad *social.InvalidError
	switch {
	case errors.As(err, &bad):
		writeError(w, http.StatusBadRequest, bad.Reason)
	case errors.Is(err, social.ErrProfileIncomplete):
		writeError(w, http.StatusConflict, "Set your name and username first.")
	case errors.Is(err, social.ErrUserNotFound):
		writeError(w, http.StatusNotFound, "No one has that username.")
	case errors.Is(err, social.ErrSelf):
		writeError(w, http.StatusBadRequest, "That's your own username.")
	case errors.Is(err, social.ErrAlreadyFriends):
		writeError(w, http.StatusConflict, "You're already friends.")
	case errors.Is(err, social.ErrYouBlocked):
		writeError(w, http.StatusConflict, "You blocked this person. Unblock them first.")
	case errors.Is(err, social.ErrNoRequest):
		writeError(w, http.StatusNotFound, "That friend request is gone.")
	case errors.Is(err, social.ErrNotFriends):
		writeError(w, http.StatusNotFound, "You're not friends with this person.")
	case errors.Is(err, social.ErrTooMany):
		writeError(w, http.StatusTooManyRequests, "You've hit the limit for now. Try again later.")
	case errors.Is(err, social.ErrMeetupNotFound):
		writeError(w, http.StatusNotFound, "This meetup doesn't exist or isn't yours.")
	case errors.Is(err, social.ErrMeetupOver):
		writeError(w, http.StatusGone, "This meetup is over.")
	case errors.Is(err, social.ErrNotHost):
		writeError(w, http.StatusForbidden, "Only the host can do that.")
	case errors.Is(err, social.ErrNotJoined):
		writeError(w, http.StatusForbidden, "Join the meetup to see where everyone is.")
	default:
		h.logger.Error("request failed", "path", r.URL.Path, "error", err)
		writeError(w, http.StatusInternalServerError, "Something went wrong. Try again.")
	}
}

type usernameBody struct {
	Username string `json:"username"`
}

func (h *socialHandlers) overview(w http.ResponseWriter, r *http.Request, me auth.User) {
	out, err := h.service.Overview(r.Context(), me)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *socialHandlers) sendRequest(w http.ResponseWriter, r *http.Request, me auth.User) {
	var body usernameBody
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := h.service.SendRequest(r.Context(), me, body.Username)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": result})
}

func (h *socialHandlers) acceptRequest(w http.ResponseWriter, r *http.Request, me auth.User) {
	if err := h.service.AcceptRequest(r.Context(), me, r.PathValue("username")); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *socialHandlers) removeRequest(w http.ResponseWriter, r *http.Request, me auth.User) {
	if err := h.service.RemoveRequest(r.Context(), me, r.PathValue("username")); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *socialHandlers) unfriend(w http.ResponseWriter, r *http.Request, me auth.User) {
	if err := h.service.Unfriend(r.Context(), me, r.PathValue("username")); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *socialHandlers) block(w http.ResponseWriter, r *http.Request, me auth.User) {
	var body usernameBody
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := h.service.Block(r.Context(), me, body.Username); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *socialHandlers) unblock(w http.ResponseWriter, r *http.Request, me auth.User) {
	if err := h.service.Unblock(r.Context(), me, r.PathValue("username")); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *socialHandlers) listMeetups(w http.ResponseWriter, r *http.Request, me auth.User) {
	list, err := h.service.ListMeetups(r.Context(), me)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meetups": list})
}

func (h *socialHandlers) createMeetup(w http.ResponseWriter, r *http.Request, me auth.User) {
	var body social.CreateMeetup
	if !decodeJSON(w, r, &body) {
		return
	}
	m, err := h.service.CreateMeetup(r.Context(), me, body)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"meetup": m})
}

func (h *socialHandlers) listPublicMeetups(w http.ResponseWriter, r *http.Request, me auth.User) {
	list, err := h.service.ListPublicMeetups(r.Context(), me)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meetups": list})
}

func (h *socialHandlers) createPublicMeetup(w http.ResponseWriter, r *http.Request, me auth.User) {
	var body social.NewPublicMeetup
	if !decodeJSON(w, r, &body) {
		return
	}
	m, err := h.service.CreatePublicMeetup(r.Context(), me, body)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"meetup": m})
}

func (h *socialHandlers) joinPublicMeetup(w http.ResponseWriter, r *http.Request, me auth.User) {
	m, err := h.service.JoinPublicMeetup(r.Context(), me, r.PathValue("id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meetup": m})
}

func (h *socialHandlers) getMeetup(w http.ResponseWriter, r *http.Request, me auth.User) {
	m, err := h.service.GetMeetup(r.Context(), me, r.PathValue("id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meetup": m})
}

func (h *socialHandlers) respond(w http.ResponseWriter, r *http.Request, me auth.User) {
	var body struct {
		Accept *bool `json:"accept"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Accept == nil {
		writeError(w, http.StatusBadRequest, "Say whether you're joining.")
		return
	}
	m, err := h.service.RespondToMeetup(r.Context(), me, r.PathValue("id"), *body.Accept)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meetup": m})
}

func (h *socialHandlers) leave(w http.ResponseWriter, r *http.Request, me auth.User) {
	m, err := h.service.LeaveMeetup(r.Context(), me, r.PathValue("id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meetup": m})
}

func (h *socialHandlers) end(w http.ResponseWriter, r *http.Request, me auth.User) {
	m, err := h.service.EndMeetup(r.Context(), me, r.PathValue("id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"meetup": m})
}

func (h *socialHandlers) liveTicket(w http.ResponseWriter, r *http.Request, me auth.User) {
	t, err := h.service.LiveTicket(r.Context(), me, r.PathValue("id"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}
