package push

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/db"
)

const maxSubscriptions = 8

var (
	ErrUnavailable = errors.New("notifications are not available")
	ErrInvalid     = errors.New("that subscription is not valid")
	ErrTooMany     = errors.New("too many notification devices")
)

type Message struct {
	// Kind is checked against what the recipient turned off. It is not part of the payload.
	Kind  string `json:"-"`
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
}

type Subscription struct {
	Endpoint  string
	CreatedAt string
}

type Service struct {
	pool   *pgxpool.Pool
	cfg    config.Config
	logger *slog.Logger
}

func New(pool *pgxpool.Pool, cfg config.Config, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{pool: pool, cfg: cfg, logger: logger}
}

func (s *Service) Available() bool {
	return s != nil && s.cfg.PushAvailable && s.cfg.VAPIDPublic != "" && s.cfg.VAPIDPrivate != "" && s.cfg.VAPIDSubject != ""
}

func (s *Service) PublicKey() string {
	if !s.Available() {
		return ""
	}
	return s.cfg.VAPIDPublic
}

func (s *Service) Save(ctx context.Context, me auth.User, endpoint, p256dh, authKey string) error {
	if !s.Available() {
		return ErrUnavailable
	}
	if me.ID == "" {
		return auth.ErrUnauthorized
	}
	endpoint, p256dh, authKey, err := normalizeSubscription(endpoint, p256dh, authKey, !s.cfg.IsProduction())
	if err != nil {
		return err
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `select count(*) from push_subscriptions where user_id = $1::uuid`, me.ID).Scan(&n); err != nil {
			return err
		}
		var owned bool
		if err := tx.QueryRow(ctx, `select exists(select 1 from push_subscriptions where user_id = $1::uuid and endpoint = $2)`, me.ID, endpoint).Scan(&owned); err != nil {
			return err
		}
		if n >= maxSubscriptions && !owned {
			return ErrTooMany
		}
		tag, err := tx.Exec(ctx, `
			insert into push_subscriptions (user_id, endpoint, p256dh, auth)
			values ($1::uuid, $2, $3, $4)
			on conflict (endpoint) do update
			  set p256dh = excluded.p256dh,
			      auth = excluded.auth,
			      updated_at = now()
			  where push_subscriptions.user_id = excluded.user_id`,
			me.ID, endpoint, p256dh, authKey)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrInvalid
		}
		return nil
	})
}

func (s *Service) Remove(ctx context.Context, me auth.User, endpoint string, all bool) error {
	if me.ID == "" {
		return auth.ErrUnauthorized
	}
	if all {
		return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `delete from push_subscriptions where user_id = $1::uuid`, me.ID)
			return err
		})
	}
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return ErrInvalid
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `delete from push_subscriptions where user_id = $1::uuid and endpoint = $2`, me.ID, endpoint)
		return err
	})
}

func (s *Service) Export(ctx context.Context, me auth.User) ([]Subscription, error) {
	if me.ID == "" {
		return nil, auth.ErrUnauthorized
	}
	var out []Subscription
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `select endpoint, created_at from push_subscriptions where user_id = $1::uuid order by created_at`, me.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item Subscription
			var created time.Time
			if err := rows.Scan(&item.Endpoint, &created); err != nil {
				return err
			}
			item.CreatedAt = created.UTC().Format(time.RFC3339)
			out = append(out, item)
		}
		return rows.Err()
	})
	if out == nil {
		out = []Subscription{}
	}
	return out, err
}

// Notify reaches every device a person turned notifications on for: Web Push, and Expo for iPhones.
func (s *Service) Notify(ctx context.Context, senderID string, userIDs []string, msg Message) {
	if s == nil || senderID == "" || len(userIDs) == 0 {
		return
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return
	}
	web := s.Available()
	for _, userID := range userIDs {
		if userID == "" || userID == senderID {
			continue
		}
		if msg.Kind != "" && !s.wanted(ctx, senderID, userID, msg.Kind) {
			continue
		}
		if web {
			subs, err := s.keysFor(ctx, senderID, userID)
			if err != nil {
				s.logger.Error("push lookup failed", "error", err)
			}
			for _, sub := range subs {
				s.send(ctx, sub, payload)
			}
		}
		tokens, badge, err := s.appTokensFor(ctx, senderID, userID)
		if err != nil {
			s.logger.Error("app push lookup failed", "error", err)
			continue
		}
		s.sendToApps(ctx, senderID, tokens, badge, msg)
	}
}

// wanted reports whether the recipient still wants this kind of notification. A failed check sends nothing.
func (s *Service) wanted(ctx context.Context, senderID, targetID, kind string) bool {
	var ok bool
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: senderID}, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `select csimap_push_wanted($1::uuid, $2)`, targetID, kind).Scan(&ok)
	})
	if err != nil {
		s.logger.Error("push preference lookup failed", "error", err)
		return false
	}
	return ok
}

type webSub struct {
	Endpoint string
	P256dh   string
	Auth     string
}

func (s *Service) keysFor(ctx context.Context, senderID, targetID string) ([]webSub, error) {
	var out []webSub
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: senderID}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `select endpoint, p256dh, auth from csimap_push_keys($1::uuid)`, targetID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var sub webSub
			if err := rows.Scan(&sub.Endpoint, &sub.P256dh, &sub.Auth); err != nil {
				return err
			}
			out = append(out, sub)
		}
		return rows.Err()
	})
	return out, err
}

func (s *Service) send(ctx context.Context, sub webSub, payload []byte) {
	// Checked again at send time, so a row saved before the allowlist existed is never contacted.
	if !pushEndpointAllowed(sub.Endpoint, !s.cfg.IsProduction()) {
		return
	}
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      s.cfg.VAPIDSubject,
		VAPIDPublicKey:  s.cfg.VAPIDPublic,
		VAPIDPrivateKey: s.cfg.VAPIDPrivate,
		TTL:             3600,
	})
	if err != nil {
		s.logger.Error("push send failed", "error", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		return
	}
	if resp.StatusCode >= 400 {
		s.logger.Error("push rejected", "status", resp.StatusCode)
	}
}

// The only push hosts allowed, so a subscription cannot make the server call an address of the user's choosing.
var pushHosts = map[string]bool{
	"fcm.googleapis.com":                true, // Chrome, Android, and other Chromium browsers
	"updates.push.services.mozilla.com": true, // Firefox
	"web.push.apple.com":                true, // Safari and installed iPhone web apps
}

// Edge and other Windows browsers get an endpoint on a numbered Windows push host.
const windowsPushSuffix = ".notify.windows.com"

func pushEndpointAllowed(endpoint string, allowLocal bool) bool {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.User != nil || parsed.Port() != "" && parsed.Scheme == "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	switch parsed.Scheme {
	case "https":
		return pushHosts[host] || (strings.HasSuffix(host, windowsPushSuffix) && len(host) > len(windowsPushSuffix))
	case "http":
		return allowLocal && isLocalPushHost(host)
	}
	return false
}

func normalizeSubscription(endpoint, p256dh, authKey string, allowLocal bool) (string, string, string, error) {
	endpoint = strings.TrimSpace(endpoint)
	p256dh = strings.TrimSpace(p256dh)
	authKey = strings.TrimSpace(authKey)
	if utf8.RuneCountInString(endpoint) < 12 || utf8.RuneCountInString(endpoint) > 2048 {
		return "", "", "", ErrInvalid
	}
	if !pushEndpointAllowed(endpoint, allowLocal) {
		return "", "", "", ErrInvalid
	}
	if utf8.RuneCountInString(p256dh) < 20 || utf8.RuneCountInString(p256dh) > 256 {
		return "", "", "", ErrInvalid
	}
	if utf8.RuneCountInString(authKey) < 8 || utf8.RuneCountInString(authKey) > 256 {
		return "", "", "", ErrInvalid
	}
	return endpoint, p256dh, authKey, nil
}

func isLocalPushHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1"
}
