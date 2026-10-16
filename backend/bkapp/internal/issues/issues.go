// Package issues keeps the problems students report with the map or the app.
package issues

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/db"
)

const (
	minMessage = 10
	maxMessage = 1000
	// Counted in the database, so the cap holds across every serverless instance.
	maxPerDay = 10
)

var ErrTooMany = errors.New("too many issue reports")

// InvalidError is a report the student can fix, with the reason to show them.
type InvalidError struct{ Reason string }

func (e *InvalidError) Error() string { return e.Reason }

func invalid(format string, args ...any) error {
	return &InvalidError{Reason: fmt.Sprintf(format, args...)}
}

// Report is one problem a student sends from the web app or the phone app.
type Report struct {
	Kind       string // bug | map | idea | other
	Message    string
	PlaceID    string
	Platform   string // web | ios | android
	AppVersion string
	MayContact bool
}

var (
	kinds      = map[string]bool{"bug": true, "map": true, "idea": true, "other": true}
	platforms  = map[string]bool{"web": true, "ios": true, "android": true}
	appVersion = regexp.MustCompile(`^[0-9]{1,3}(\.[0-9]{1,3}){1,2}$`)
)

type Service struct {
	pool   *pgxpool.Pool
	places map[string]bool
}

func NewService(pool *pgxpool.Pool, site *campus.Campus) *Service {
	places := make(map[string]bool, len(site.Places))
	for _, place := range site.Places {
		places[place.ID] = true
	}
	return &Service{pool: pool, places: places}
}

// File stores a report from a signed-in student.
func (s *Service) File(ctx context.Context, me auth.User, report Report) error {
	if me.ID == "" {
		return auth.ErrUnauthorized
	}
	if !kinds[report.Kind] {
		return invalid("Pick what kind of problem this is.")
	}
	if !platforms[report.Platform] {
		return invalid("Reports can only come from the CSI Map website or app.")
	}

	message := strings.TrimSpace(strings.ReplaceAll(report.Message, "\r\n", "\n"))
	length := utf8.RuneCountInString(message)
	if length < minMessage {
		return invalid("Tell us a little more, at least %d characters.", minMessage)
	}
	if length > maxMessage {
		return invalid("Keep it under %d characters.", maxMessage)
	}
	for _, r := range message {
		if (r < 0x20 && r != '\n') || r == 0x7f {
			return invalid("The message has characters that are not allowed.")
		}
	}

	var place, version *string
	if id := strings.TrimSpace(report.PlaceID); id != "" {
		if !s.places[id] {
			return invalid("That place is not on the map.")
		}
		place = &id
	}
	if v := strings.TrimSpace(report.AppVersion); v != "" {
		if !appVersion.MatchString(v) {
			return invalid("That app version is not valid.")
		}
		version = &v
	}

	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		var recent int
		if err := tx.QueryRow(ctx,
			`select count(*)::int from issue_reports where reporter_id = $1::uuid and created_at > now() - interval '1 day'`,
			me.ID,
		).Scan(&recent); err != nil {
			return err
		}
		if recent >= maxPerDay {
			return ErrTooMany
		}
		_, err := tx.Exec(ctx, `
			insert into issue_reports (reporter_id, kind, message, place_id, platform, app_version, may_contact)
			values ($1::uuid, $2, $3, $4, $5, $6, $7)`,
			me.ID, report.Kind, message, place, report.Platform, version, report.MayContact)
		return err
	})
}
