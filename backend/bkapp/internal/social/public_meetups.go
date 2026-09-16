package social

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/db"
)

const (
	maxTitleRunes      = 60
	minTitleRunes      = 3
	maxStartsInMinutes = 7 * 24 * 60
	maxPublicPerDay    = 3
	maxActivePublic    = 2
	maxPublicAttendees = 200
	publicListLimit    = 20
	maxPublicMinutes   = 8 * 60
)

// NewPublicMeetup is a campus wide meetup: a name, when it starts, and where. The place stays hidden
// until it starts, and nobody shares a live location.
type NewPublicMeetup struct {
	Title       string           `json:"title"`
	Note        string           `json:"note"`
	Destination DestinationInput `json:"destination"`
	StartsIn    int              `json:"startsIn"`
	Minutes     int              `json:"minutes"`
}

func cleanTitle(raw string) (string, error) {
	title := collapseSpace.ReplaceAllString(strings.TrimSpace(raw), " ")
	count := utf8.RuneCountInString(title)
	if count < minTitleRunes || count > maxTitleRunes {
		return "", invalid("Give it a name between %d and %d characters.", minTitleRunes, maxTitleRunes)
	}
	for _, r := range title {
		if r < 0x20 || r == 0x7f {
			return "", invalid("The name has characters that are not allowed.")
		}
	}
	return title, nil
}

func (s *Service) CreatePublicMeetup(ctx context.Context, me auth.User, in NewPublicMeetup) (Meetup, error) {
	if err := ready(me); err != nil {
		return Meetup{}, err
	}
	title, err := cleanTitle(in.Title)
	if err != nil {
		return Meetup{}, err
	}
	note, err := cleanNote(in.Note)
	if err != nil {
		return Meetup{}, err
	}
	if in.StartsIn < 0 || in.StartsIn > maxStartsInMinutes {
		return Meetup{}, invalid("Start it now or up to a week from now.")
	}
	minutes := in.Minutes
	if minutes == 0 {
		minutes = defaultMeetupMinutes
	}
	if minutes < minMeetupMinutes || minutes > maxPublicMinutes {
		return Meetup{}, invalid("Public meetups last between %d minutes and %d hours.", minMeetupMinutes, maxPublicMinutes/60)
	}

	var place *string
	var lat, lng *float64
	switch in.Destination.Kind {
	case DestinationPlace:
		id := strings.ToUpper(in.Destination.PlaceID)
		found := false
		for _, p := range s.site.Places {
			if p.ID == id {
				found = true
				break
			}
		}
		if !found {
			return Meetup{}, invalid("That place is not on the campus map.")
		}
		place = &id
	case DestinationPin:
		if in.Destination.Lat == nil || in.Destination.Lng == nil || !s.site.WalkingArea.Contains(*in.Destination.Lat, *in.Destination.Lng) {
			return Meetup{}, invalid("Drop the pin somewhere on campus.")
		}
		lat, lng = in.Destination.Lat, in.Destination.Lng
	default:
		return Meetup{}, invalid("Public meetups meet at a place or a pin.")
	}

	publicID, err := s.publicID()
	if err != nil {
		return Meetup{}, err
	}
	now := s.now()
	startsAt := now.Add(time.Duration(in.StartsIn) * time.Minute)

	var created Meetup
	err = db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		var today, active int
		if err := tx.QueryRow(ctx,
			`select
			   (select count(*) from meetups where host_id = $1::uuid and visibility = 'public' and created_at > $2),
			   (select count(*) from meetups where host_id = $1::uuid and visibility = 'public' and ended_at is null and expires_at > $3)`,
			me.ID, now.Add(-24*time.Hour), now,
		).Scan(&today, &active); err != nil {
			return err
		}
		if today >= maxPublicPerDay || active >= maxActivePublic {
			return ErrTooMany
		}

		var notePtr *string
		if note != "" {
			notePtr = &note
		}
		var meetupID string
		if err := tx.QueryRow(ctx,
			`insert into meetups (public_id, host_id, visibility, title, note, destination_kind, destination_place,
			                      destination_lat, destination_lng, starts_at, expires_at)
			 values ($1, $2::uuid, 'public', $3, $4, $5, $6, $7, $8, $9, $10) returning id::text`,
			publicID, me.ID, title, notePtr, in.Destination.Kind, place, lat, lng,
			startsAt, startsAt.Add(time.Duration(minutes)*time.Minute),
		).Scan(&meetupID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`insert into meetup_members (meetup_id, user_id, role, status) values ($1::uuid, $2::uuid, 'host', 'joined')`,
			meetupID, me.ID); err != nil {
			return err
		}
		created, err = s.load(ctx, tx, me, publicID)
		return err
	})
	return created, err
}

// ListPublicMeetups shows what is coming up on campus, soonest first.
func (s *Service) ListPublicMeetups(ctx context.Context, me auth.User) ([]Meetup, error) {
	out := []Meetup{}
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`select public_id from meetups
			 where visibility = 'public' and ended_at is null and expires_at > $1
			 order by starts_at limit $2`, s.now(), publicListLimit)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, id := range ids {
			m, err := s.load(ctx, tx, me, id)
			if err != nil {
				return err
			}
			out = append(out, m)
		}
		return nil
	})
	return out, err
}

// JoinPublicMeetup adds you to a public meetup, or puts you back after leaving.
func (s *Service) JoinPublicMeetup(ctx context.Context, me auth.User, publicID string) (Meetup, error) {
	if err := ready(me); err != nil {
		return Meetup{}, err
	}
	if !validPublicID(publicID) {
		return Meetup{}, ErrMeetupNotFound
	}

	var m Meetup
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		current, err := s.load(ctx, tx, me, publicID)
		if err != nil {
			return err
		}
		if current.Visibility != VisibilityPublic {
			return ErrMeetupNotFound
		}
		if !current.Active {
			return ErrMeetupOver
		}
		if current.YourStatus != StatusJoined {
			if current.Going >= maxPublicAttendees {
				return ErrTooMany
			}
			if _, err := tx.Exec(ctx,
				`insert into meetup_members (meetup_id, user_id, role, status)
				 values ((select id from meetups where public_id = $1), $2::uuid, 'guest', 'joined')
				 on conflict (meetup_id, user_id) do update set status = 'joined', updated_at = now()`,
				publicID, me.ID); err != nil {
				return err
			}
		}
		m, err = s.load(ctx, tx, me, publicID)
		return err
	})
	return m, err
}
