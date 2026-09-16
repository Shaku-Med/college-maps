package social

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/db"
)

const maxExportMeetups = 50

// Export is everything this student may see about themselves: friends and meetups, no emails or ids.
func (s *Service) Export(ctx context.Context, me auth.User) (Overview, []Meetup, error) {
	out := Overview{Friends: []Friend{}, Incoming: []Request{}, Outgoing: []Request{}, Blocked: []Person{}}
	if ready(me) == nil {
		friends, err := s.Overview(ctx, me)
		if err != nil {
			return Overview{}, nil, err
		}
		out = friends
	}

	meetups := []Meetup{}
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`select m.public_id from meetups m
			 join meetup_members mm on mm.meetup_id = m.id and mm.user_id = $1::uuid
			 order by m.created_at desc limit $2`, me.ID, maxExportMeetups)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, id := range ids {
			m, err := s.load(ctx, tx, me, id)
			if errors.Is(err, ErrMeetupNotFound) {
				continue
			}
			if err != nil {
				return err
			}
			meetups = append(meetups, scrubExportMeetup(m))
		}
		return nil
	})
	return out, meetups, err
}

func scrubExportMeetup(m Meetup) Meetup {
	m.YourLiveID = ""
	if m.Destination != nil {
		m.Destination.LiveID = ""
	}
	for i := range m.Members {
		m.Members[i].LiveID = ""
	}
	return m
}
