// Package settings keeps a student's preferences with their account, so they follow them to any device.
package settings

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/db"
)

// Settings holds every preference the account keeps. An empty Voice means none has been chosen.
type Settings struct {
	Voice  string `json:"voice"`
	Notify Notify `json:"notify"`
}

// Notify is which notifications the student wants, on every phone and browser they use.
type Notify struct {
	FriendRequests bool `json:"friendRequests"`
	MeetupInvites  bool `json:"meetupInvites"`
	MeetupJoins    bool `json:"meetupJoins"`
}

// Patch changes only the preferences it names.
type Patch struct {
	Voice          *string
	FriendRequests *bool
	MeetupInvites  *bool
	MeetupJoins    *bool
}

func defaults() Settings {
	return Settings{Notify: Notify{FriendRequests: true, MeetupInvites: true, MeetupJoins: true}}
}

var ErrInvalidVoice = errors.New("unknown voice")

// The voices the app offers.
var voices = map[string]bool{
	"device":     true,
	"af_heart":   true,
	"af_bella":   true,
	"af_nicole":  true,
	"bf_emma":    true,
	"am_michael": true,
	"am_fenrir":  true,
	"bm_george":  true,
}

func ValidVoice(voice string) bool {
	return voice == "" || voices[voice]
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) Get(ctx context.Context, me auth.User) (Settings, error) {
	if me.ID == "" {
		return Settings{}, auth.ErrUnauthorized
	}
	var out Settings
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) (err error) {
		out, err = read(ctx, tx, me.ID)
		return err
	})
	return out, err
}

func read(ctx context.Context, tx pgx.Tx, userID string) (Settings, error) {
	out := defaults()
	var voice *string
	err := tx.QueryRow(ctx,
		`select voice, notify_friend_requests, notify_meetup_invites, notify_meetup_joins
		 from user_settings where user_id = $1::uuid`, userID,
	).Scan(&voice, &out.Notify.FriendRequests, &out.Notify.MeetupInvites, &out.Notify.MeetupJoins)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return Settings{}, err
	}
	if voice != nil {
		out.Voice = *voice
	}
	return out, nil
}

// Save applies the changes in patch and returns every setting. An empty voice clears the choice.
func (s *Service) Save(ctx context.Context, me auth.User, patch Patch) (Settings, error) {
	if me.ID == "" {
		return Settings{}, auth.ErrUnauthorized
	}
	if patch.Voice != nil && !ValidVoice(*patch.Voice) {
		return Settings{}, ErrInvalidVoice
	}
	var out Settings
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		current, err := read(ctx, tx, me.ID)
		if err != nil {
			return err
		}
		if patch.Voice != nil {
			current.Voice = *patch.Voice
		}
		if patch.FriendRequests != nil {
			current.Notify.FriendRequests = *patch.FriendRequests
		}
		if patch.MeetupInvites != nil {
			current.Notify.MeetupInvites = *patch.MeetupInvites
		}
		if patch.MeetupJoins != nil {
			current.Notify.MeetupJoins = *patch.MeetupJoins
		}
		var voice *string
		if current.Voice != "" {
			voice = &current.Voice
		}
		if _, err := tx.Exec(ctx, `
			insert into user_settings (user_id, voice, notify_friend_requests, notify_meetup_invites, notify_meetup_joins)
			values ($1::uuid, $2, $3, $4, $5)
			on conflict (user_id) do update set voice = excluded.voice,
			  notify_friend_requests = excluded.notify_friend_requests,
			  notify_meetup_invites = excluded.notify_meetup_invites,
			  notify_meetup_joins = excluded.notify_meetup_joins,
			  updated_at = now()`,
			me.ID, voice, current.Notify.FriendRequests, current.Notify.MeetupInvites, current.Notify.MeetupJoins); err != nil {
			return err
		}
		out = current
		return nil
	})
	return out, err
}
