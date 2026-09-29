package social

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/db"
)

// busyElsewhere stops someone being in two meetups at once: it fails when they already joined another live
// meetup whose time overlaps from..until. Invites still arrive; they leave the other one to accept.
func (s *Service) busyElsewhere(ctx context.Context, tx pgx.Tx, userID, exceptPublicID string, from, until time.Time) error {
	var busy bool
	if err := tx.QueryRow(ctx,
		`select exists (
		   select 1 from meetups m join meetup_members mm on mm.meetup_id = m.id
		   where mm.user_id = $1::uuid and mm.status = 'joined' and m.public_id <> $2
		     and m.ended_at is null and m.expires_at > $3
		     and coalesce(m.starts_at, m.created_at) < $5 and m.expires_at > $4)`,
		userID, exceptPublicID, s.now(), from, until,
	).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return ErrBusy
	}
	return nil
}

func meetupStart(m Meetup) time.Time {
	if m.StartsAt != nil {
		return *m.StartsAt
	}
	return m.CreatedAt
}

// othersInMeetup is who hears that someone joined: everyone already in a private meetup, or the host of a
// public one, where telling every attendee about every other would be noise.
func (s *Service) othersInMeetup(ctx context.Context, tx pgx.Tx, meID, publicID string) ([]string, error) {
	rows, err := tx.Query(ctx,
		`select mm.user_id::text from meetup_members mm join meetups m on m.id = mm.meetup_id
		 where m.public_id = $1 and mm.status = 'joined' and mm.user_id <> $2::uuid
		   and (m.visibility = 'private' or mm.role = 'host')`, publicID, meID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func displayName(me auth.User) string {
	if me.DisplayName != "" {
		return me.DisplayName
	}
	return me.Username
}

func (s *Service) pingJoined(me auth.User, userIDs []string, m Meetup) {
	what := "your meetup"
	if m.Title != "" {
		what = m.Title
	}
	s.ping(NotifyJoin, me.ID, userIDs, s.site.AppName, displayName(me)+" joined "+what, "/")
}

// InviteToMeetup adds friends to a live private meetup the host runs, including anyone who left or said no,
// so a mistaken tap on Leave is easy to undo. Someone who asked to stay out is not invited again.
func (s *Service) InviteToMeetup(ctx context.Context, me auth.User, publicID string, friends []string) (Meetup, error) {
	if err := ready(me); err != nil {
		return Meetup{}, err
	}
	if !validPublicID(publicID) {
		return Meetup{}, ErrMeetupNotFound
	}
	if len(friends) == 0 || len(friends) > MaxGuests {
		return Meetup{}, invalid("Invite between 1 and %d friends.", MaxGuests)
	}
	handles := make([]string, 0, len(friends))
	seen := map[string]bool{}
	for _, raw := range friends {
		handle, ok := normalizeUsername(raw)
		if !ok {
			return Meetup{}, invalid("That doesn't look like a username.")
		}
		if handle == me.Username {
			return Meetup{}, ErrSelf
		}
		if !seen[handle] {
			seen[handle] = true
			handles = append(handles, handle)
		}
	}

	var m Meetup
	var invited []string
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		if err := lockUser(ctx, tx, me.ID); err != nil {
			return err
		}
		current, err := s.load(ctx, tx, me, publicID)
		if err != nil {
			return err
		}
		if current.YourRole != "host" || current.Visibility != VisibilityPrivate {
			return ErrNotHost
		}
		if !current.Active {
			return ErrMeetupOver
		}
		var meetupID string
		var guests int
		if err := tx.QueryRow(ctx,
			`select m.id::text, (select count(*) from meetup_members mm
			                     where mm.meetup_id = m.id and mm.role = 'guest' and mm.status in ('invited', 'joined'))
			 from meetups m where m.public_id = $1`, publicID).Scan(&meetupID, &guests); err != nil {
			return err
		}
		for _, handle := range handles {
			var id string
			err := tx.QueryRow(ctx,
				`select d.id::text from user_directory d
				 join friendships f on (f.user_low = d.id and f.user_high = $2::uuid) or (f.user_high = d.id and f.user_low = $2::uuid)
				 where d.username = $1`, handle, me.ID).Scan(&id)
			if errors.Is(err, pgx.ErrNoRows) {
				return invalid("You can only invite friends. @%s is not on your friends list.", handle)
			}
			if err != nil {
				return err
			}
			var status string
			var staysOut bool
			err = tx.QueryRow(ctx, `select status, invites_off from meetup_members where meetup_id = $1::uuid and user_id = $2::uuid`,
				meetupID, id).Scan(&status, &staysOut)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if status == StatusInvited || status == StatusJoined {
				continue
			}
			if staysOut {
				return invalid("@%s asked not to be invited back to this meetup.", handle)
			}
			if guests >= MaxGuests {
				return invalid("A meetup can have up to %d friends.", MaxGuests)
			}
			if status == "" {
				if _, err := tx.Exec(ctx,
					`insert into meetup_members (meetup_id, user_id, role, status) values ($1::uuid, $2::uuid, 'guest', 'invited')`,
					meetupID, id); err != nil {
					return err
				}
			} else {
				var ok bool
				if err := tx.QueryRow(ctx, `select csimap_reinvite_member($1::uuid, $2::uuid)`, meetupID, id).Scan(&ok); err != nil {
					return err
				}
				if !ok {
					return invalid("@%s can't be invited back right now.", handle)
				}
			}
			guests++
			invited = append(invited, id)
		}
		m, err = s.load(ctx, tx, me, publicID)
		return err
	})
	if err == nil && len(invited) > 0 {
		s.ping(NotifyInvite, me.ID, invited, s.site.AppName, displayName(me)+" invited you to walk together", "/")
	}
	return m, err
}
