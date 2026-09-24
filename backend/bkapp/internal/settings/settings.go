// Package settings keeps a student's app preferences with their account, so a choice made on one device
// follows them to the next.
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
	Voice string `json:"voice"`
}

var ErrInvalidVoice = errors.New("unknown voice")

// The voices the app offers. "device" is the phone's own speech engine; the rest are Kokoro voices that
// run on the phone. Anything else is refused, so the column only ever holds one of these.
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
	var voice *string
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `select voice from user_settings where user_id = $1::uuid`, me.ID).Scan(&voice)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	})
	if err != nil {
		return Settings{}, err
	}
	if voice == nil {
		return Settings{}, nil
	}
	return Settings{Voice: *voice}, nil
}

// Save replaces the student's settings. An empty voice clears the choice.
func (s *Service) Save(ctx context.Context, me auth.User, next Settings) (Settings, error) {
	if me.ID == "" {
		return Settings{}, auth.ErrUnauthorized
	}
	if !ValidVoice(next.Voice) {
		return Settings{}, ErrInvalidVoice
	}
	var voice *string
	if next.Voice != "" {
		voice = &next.Voice
	}
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			insert into user_settings (user_id, voice) values ($1::uuid, $2)
			on conflict (user_id) do update set voice = excluded.voice, updated_at = now()`,
			me.ID, voice)
		return err
	})
	if err != nil {
		return Settings{}, err
	}
	return next, nil
}
