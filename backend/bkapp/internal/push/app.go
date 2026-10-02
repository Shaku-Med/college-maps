package push

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/db"
)

// Expo's push service has a fixed address, so nothing a user sends decides where the server connects.
const (
	expoPushURL      = "https://exp.host/--/api/v2/push/send"
	maxAppTokens     = 8
	maxExpoBody      = 64 << 10
	expoPushDeadline = 10 * time.Second
)

var expoToken = regexp.MustCompile(`^ExponentPushToken\[[A-Za-z0-9_-]{8,128}\]$`)

var expoClient = &http.Client{Timeout: expoPushDeadline}

// SaveAppToken registers or refreshes a phone's push token, moving it from any previous account.
func (s *Service) SaveAppToken(ctx context.Context, me auth.User, token string, badge bool) error {
	if s == nil {
		return ErrUnavailable
	}
	token = strings.TrimSpace(token)
	if !expoToken.MatchString(token) {
		return ErrInvalid
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select csimap_claim_app_push_token($1)`, token); err != nil {
			return err
		}
		var n int
		var owned bool
		if err := tx.QueryRow(ctx,
			`select count(*), coalesce(bool_or(token = $2), false) from app_push_tokens where user_id = $1::uuid`,
			me.ID, token,
		).Scan(&n, &owned); err != nil {
			return err
		}
		if owned {
			_, err := tx.Exec(ctx, `update app_push_tokens set badge = $2, updated_at = now() where token = $1`, token, badge)
			return err
		}
		if n >= maxAppTokens {
			return ErrTooMany
		}
		_, err := tx.Exec(ctx,
			`insert into app_push_tokens (user_id, token, badge) values ($1::uuid, $2, $3) on conflict (token) do nothing`, me.ID, token, badge)
		return err
	})
}

// RemoveAppToken stops notifications to one phone, or to every phone on the account.
func (s *Service) RemoveAppToken(ctx context.Context, me auth.User, token string, all bool) error {
	if s == nil {
		return nil
	}
	token = strings.TrimSpace(token)
	if !all && !expoToken.MatchString(token) {
		return ErrInvalid
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		if all {
			_, err := tx.Exec(ctx, `delete from app_push_tokens where user_id = $1::uuid`, me.ID)
			return err
		}
		_, err := tx.Exec(ctx, `delete from app_push_tokens where user_id = $1::uuid and token = $2`, me.ID, token)
		return err
	})
}

type appToken struct {
	Token string
	Badge bool
}

// appTokensFor returns the phones to notify and the count for the icon badge on those that show one.
func (s *Service) appTokensFor(ctx context.Context, senderID, targetID string) ([]appToken, int, error) {
	var out []appToken
	var badge int
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: senderID}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `select token, badge from csimap_app_push_tokens($1::uuid)`, targetID)
		if err != nil {
			return err
		}
		if out, err = pgx.CollectRows(rows, pgx.RowToStructByPos[appToken]); err != nil || len(out) == 0 {
			return err
		}
		return tx.QueryRow(ctx, `select csimap_app_push_badge($1::uuid)`, targetID).Scan(&badge)
	})
	return out, badge, err
}

type expoMessage struct {
	To    string            `json:"to"`
	Title string            `json:"title"`
	Body  string            `json:"body"`
	Sound string            `json:"sound"`
	Badge int               `json:"badge"`
	Data  map[string]string `json:"data"`
}

type expoTicket struct {
	Status  string `json:"status"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

// sendToApps delivers to a person's phones and forgets any that Expo says uninstalled or opted out.
func (s *Service) sendToApps(ctx context.Context, senderID string, tokens []appToken, badge int, msg Message) {
	if len(tokens) == 0 {
		return
	}
	messages := make([]expoMessage, 0, len(tokens))
	for _, token := range tokens {
		count := 0
		if token.Badge {
			count = badge
		}
		messages = append(messages, expoMessage{To: token.Token, Title: msg.Title, Body: msg.Body, Sound: "default", Badge: count, Data: map[string]string{"url": msg.URL}})
	}
	body, err := json.Marshal(messages)
	if err != nil {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, expoPushURL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if s.cfg.ExpoAccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.cfg.ExpoAccessToken)
	}
	resp, err := expoClient.Do(req)
	if err != nil {
		s.logger.Error("app push send failed", "error", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		s.logger.Error("app push rejected", "status", resp.StatusCode)
		return
	}
	var result struct {
		Data []expoTicket `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxExpoBody)).Decode(&result); err != nil {
		return
	}
	for i, ticket := range result.Data {
		if i >= len(tokens) || ticket.Status != "error" {
			continue
		}
		if ticket.Details.Error == "DeviceNotRegistered" {
			s.forgetAppToken(ctx, senderID, tokens[i].Token)
		} else {
			s.logger.Error("app push ticket error", "error", ticket.Details.Error)
		}
	}
}

func (s *Service) forgetAppToken(ctx context.Context, senderID, token string) {
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: senderID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `select csimap_forget_app_push_token($1)`, token)
		return err
	})
	if err != nil {
		s.logger.Error("forgetting an app push token failed", "error", err)
	}
}
