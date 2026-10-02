// Command seedcampus adds a campus bot and demo building events for development; safe to rerun.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/db"
	"csimap/bkapp/internal/email"
)

const (
	seedEmail    = "campus.events@stu-mail.csi.cuny.edu"
	seedUsername = "csi_pulse"
	seedName     = "Campus Pulse"
	seedNote     = "seed:campus-heat"
)

type catchMail struct{ code string }

func (c *catchMail) SendLoginCode(_ context.Context, _, code string) error {
	c.code = code
	return nil
}

var _ email.Sender = (*catchMail)(nil)

type seedEvent struct {
	title   string
	placeID string
	startIn time.Duration
	length  time.Duration
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "seedcampus:", err)
		os.Exit(1)
	}
}

func run() error {
	if _, _, err := config.LoadEnvFile(); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	site, err := campus.Load()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	catch := &catchMail{}
	authService, err := auth.NewService(auth.NewPostgresStore(pool), catch, cfg.AuthSecret, site.EmailDomains)
	if err != nil {
		return err
	}
	if err := authService.RequestCode(ctx, seedEmail); err != nil {
		return fmt.Errorf("request code: %w", err)
	}
	if catch.code == "" {
		return fmt.Errorf("login code was not issued")
	}
	user, _, err := authService.VerifyCode(ctx, seedEmail, catch.code)
	if err != nil {
		return fmt.Errorf("verify: %w", err)
	}
	name, handle := seedName, seedUsername
	if updated, err := authService.UpdateProfile(ctx, user, &name, &handle); err == nil {
		user = updated
	} else if user.Username == "" {
		return fmt.Errorf("profile: %w", err)
	}

	placeOK := map[string]bool{}
	for _, p := range site.Places {
		placeOK[p.ID] = true
	}
	events := []seedEvent{
		{title: "Study group — midterms", placeID: "1L", startIn: 0, length: 3 * time.Hour},
		{title: "Club fair drop-in", placeID: "1C", startIn: 20 * time.Minute, length: 4 * time.Hour},
		{title: "Open rehearsal", placeID: "1P", startIn: 45 * time.Minute, length: 2 * time.Hour},
		{title: "Career chat with alumni", placeID: "3N", startIn: 90 * time.Minute, length: 2 * time.Hour},
		{title: "Physics help desk", placeID: "1N", startIn: 10 * time.Minute, length: 2 * time.Hour},
		{title: "Engineering build night", placeID: "4N", startIn: 2 * time.Hour, length: 3 * time.Hour},
		{title: "Quiet study floor", placeID: "1L", startIn: time.Hour, length: 4 * time.Hour},
		{title: "Campus Center hangout", placeID: "1C", startIn: 5 * time.Minute, length: 5 * time.Hour},
	}
	for _, e := range events {
		if !placeOK[e.placeID] {
			return fmt.Errorf("unknown place %s", e.placeID)
		}
	}

	now := time.Now()
	var created int
	err = db.WithScope(ctx, pool, db.Scope{UserID: user.ID}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`delete from meetups
			 where host_id = $1::uuid and visibility = 'public' and coalesce(note, '') = $2`,
			user.ID, seedNote); err != nil {
			return err
		}
		for _, e := range events {
			publicID, err := newPublicID()
			if err != nil {
				return err
			}
			starts := now.Add(e.startIn)
			expires := starts.Add(e.length)
			note := seedNote
			var meetupID string
			if err := tx.QueryRow(ctx,
				`insert into meetups (public_id, host_id, visibility, title, note, destination_kind, destination_place, starts_at, expires_at)
				 values ($1, $2::uuid, 'public', $3, $4, 'place', $5, $6, $7)
				 returning id::text`,
				publicID, user.ID, e.title, note, e.placeID, starts, expires,
			).Scan(&meetupID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx,
				`insert into meetup_members (meetup_id, user_id, role, status)
				 values ($1::uuid, $2::uuid, 'host', 'joined')`,
				meetupID, user.ID); err != nil {
				return err
			}
			created++
			fmt.Printf("  %s @ %s\n", e.title, e.placeID)
		}
		return nil
	})
	if err != nil {
		return err
	}
	fmt.Printf("seeded %d campus events as @%s\n", created, user.Username)
	return nil
}

func newPublicID() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
