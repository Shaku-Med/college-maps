package social

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/db"
)

const (
	maxReportDetails = 500
	maxReportsHour   = 20
)

var ErrReportLimit = errors.New("too many reports")

// Report is what a student files about an event or another person.
type Report struct {
	Kind     string // meetup | user
	MeetupID string
	Username string
	Reason   string // spam | harassment | inappropriate | other
	Details  string
}

var reportReasons = map[string]bool{
	"spam":          true,
	"harassment":    true,
	"inappropriate": true,
	"other":         true,
}

// FileReport stores a content report. The reporter must be signed in with a profile; they cannot report themselves.
func (s *Service) FileReport(ctx context.Context, me auth.User, report Report) error {
	if me.ID == "" || me.Username == "" {
		return ErrProfileIncomplete
	}
	kind := strings.TrimSpace(report.Kind)
	reason := strings.TrimSpace(report.Reason)
	if !reportReasons[reason] {
		return invalid("Pick a reason for the report.")
	}
	details := strings.TrimSpace(report.Details)
	if details != "" {
		if utf8.RuneCountInString(details) > maxReportDetails {
			return invalid("Keep the details under %d characters.", maxReportDetails)
		}
		for _, r := range details {
			if r < 0x20 || r == 0x7f || r == '<' || r == '>' {
				return invalid("The details have characters that are not allowed.")
			}
		}
	} else {
		details = ""
	}

	var meetupID, username *string
	switch kind {
	case "meetup":
		id := strings.TrimSpace(report.MeetupID)
		if !validPublicID(id) {
			return invalid("That event could not be reported.")
		}
		meetupID = &id
	case "user":
		handle, ok := normalizeUsername(report.Username)
		if !ok {
			return invalid("That username could not be reported.")
		}
		if handle == me.Username {
			return ErrSelf
		}
		username = &handle
	default:
		return invalid("That report type is not supported.")
	}

	lookup := ""
	if username != nil {
		lookup = *username
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID, LookupUsername: lookup}, func(tx pgx.Tx) error {
		var recent int
		if err := tx.QueryRow(ctx,
			`select count(*)::int from content_reports where reporter_id = $1::uuid and created_at > now() - interval '1 hour'`,
			me.ID,
		).Scan(&recent); err != nil {
			return err
		}
		if recent >= maxReportsHour {
			return ErrReportLimit
		}

		if kind == "meetup" {
			// Must be a meetup the reporter is allowed to see (member, invitee, or live public event).
			if _, err := s.load(ctx, tx, me, *meetupID); err != nil {
				if errors.Is(err, ErrMeetupNotFound) || errors.Is(err, pgx.ErrNoRows) {
					return invalid("That event could not be reported.")
				}
				return err
			}
		}
		if kind == "user" {
			if _, err := find(ctx, tx, *username); err != nil {
				if errors.Is(err, ErrUserNotFound) {
					return invalid("No one has that username.")
				}
				return err
			}
		}

		var detailsArg any
		if details != "" {
			detailsArg = details
		}
		_, err := tx.Exec(ctx, `
			insert into content_reports (reporter_id, target_kind, meetup_public_id, reported_username, reason, details)
			values ($1::uuid, $2, $3, $4, $5, $6)`,
			me.ID, kind, meetupID, username, reason, detailsArg)
		return err
	})
}
