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
	endpoint, p256dh, authKey, err := normalizeSubscription(endpoint, p256dh, authKey)
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

func (s *Service) Notify(ctx context.Context, senderID string, userIDs []string, msg Message) {
	if !s.Available() || senderID == "" || len(userIDs) == 0 {
		return
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return
	}
	for _, userID := range userIDs {
		if userID == "" || userID == senderID {
			continue
		}
		subs, err := s.keysFor(ctx, senderID, userID)
		if err != nil {
			s.logger.Error("push lookup failed", "error", err)
			continue
		}
		for _, sub := range subs {
			s.send(ctx, sub, payload)
		}
	}
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

func normalizeSubscription(endpoint, p256dh, authKey string) (string, string, string, error) {
	endpoint = strings.TrimSpace(endpoint)
	p256dh = strings.TrimSpace(p256dh)
	authKey = strings.TrimSpace(authKey)
	if utf8.RuneCountInString(endpoint) < 12 || utf8.RuneCountInString(endpoint) > 2048 {
		return "", "", "", ErrInvalid
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLocalPushHost(parsed.Hostname()))) {
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
