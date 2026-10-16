package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/issues"
)

// Room for a full message even when every character takes four bytes.
const maxIssueBodyBytes = 8 << 10

type issueHandlers struct {
	service *issues.Service
	logger  *slog.Logger
}

func (h *issueHandlers) file(w http.ResponseWriter, r *http.Request, user auth.User) {
	var body struct {
		Kind       string `json:"kind"`
		Message    string `json:"message"`
		PlaceID    string `json:"placeId"`
		Platform   string `json:"platform"`
		AppVersion string `json:"appVersion"`
		MayContact bool   `json:"mayContact"`
	}
	if !decodeJSONUpTo(w, r, &body, maxIssueBodyBytes) {
		return
	}
	err := h.service.File(r.Context(), user, issues.Report{
		Kind:       body.Kind,
		Message:    body.Message,
		PlaceID:    body.PlaceID,
		Platform:   body.Platform,
		AppVersion: body.AppVersion,
		MayContact: body.MayContact,
	})
	if err != nil {
		h.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *issueHandlers) fail(w http.ResponseWriter, err error) {
	var bad *issues.InvalidError
	switch {
	case errors.As(err, &bad):
		writeError(w, http.StatusBadRequest, bad.Reason)
	case errors.Is(err, issues.ErrTooMany):
		writeError(w, http.StatusTooManyRequests, "You've sent a lot of reports today. Try again tomorrow.")
	case errors.Is(err, auth.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "Sign in first.")
	default:
		h.logger.Error("issue report failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Something went wrong. Try again.")
	}
}
