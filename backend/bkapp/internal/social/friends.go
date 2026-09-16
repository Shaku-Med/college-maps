package social

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/db"
)

const (
	maxFriends          = 1000
	maxPendingOutgoing  = 50
	maxRequestsPerDay   = 30
	RequestSent         = "sent"
	RequestAlreadySent  = "pending"
	RequestBecameFriend = "friends"
)

type Friend struct {
	Person
	Since time.Time `json:"since"`
}

type Request struct {
	Person
	SentAt time.Time `json:"sentAt"`
}

type Overview struct {
	Friends  []Friend  `json:"friends"`
	Incoming []Request `json:"incoming"`
	Outgoing []Request `json:"outgoing"`
	Blocked  []Person  `json:"blocked"`
}

func ready(me auth.User) error {
	if me.Username == "" || me.DisplayName == "" {
		return ErrProfileIncomplete
	}
	return nil
}

// orderedPair returns the two ids the way the friendships table stores them, smaller first.
func orderedPair(a, b string) (string, string) {
	if a < b {
		return a, b
	}
	return b, a
}

func (s *Service) Overview(ctx context.Context, me auth.User) (Overview, error) {
	out := Overview{Friends: []Friend{}, Incoming: []Request{}, Outgoing: []Request{}, Blocked: []Person{}}
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`select d.username, coalesce(d.display_name, ''), f.created_at
			 from friendships f
			 join user_directory d on d.id = case when f.user_low = $1::uuid then f.user_high else f.user_low end
			 order by lower(coalesce(d.display_name, d.username))`, me.ID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var f Friend
			if err := rows.Scan(&f.Username, &f.DisplayName, &f.Since); err != nil {
				return err
			}
			out.Friends = append(out.Friends, f)
		}
		if err := rows.Err(); err != nil {
			return err
		}

		for _, q := range []struct {
			sql  string
			into *[]Request
		}{
			{`select d.username, coalesce(d.display_name, ''), r.created_at from friend_requests r join user_directory d on d.id = r.from_user where r.to_user = $1::uuid order by r.created_at desc`, &out.Incoming},
			{`select d.username, coalesce(d.display_name, ''), r.created_at from friend_requests r join user_directory d on d.id = r.to_user where r.from_user = $1::uuid order by r.created_at desc`, &out.Outgoing},
		} {
			rows, err := tx.Query(ctx, q.sql, me.ID)
			if err != nil {
				return err
			}
			for rows.Next() {
				var r Request
				if err := rows.Scan(&r.Username, &r.DisplayName, &r.SentAt); err != nil {
					return err
				}
				*q.into = append(*q.into, r)
			}
			if err := rows.Err(); err != nil {
				return err
			}
		}

		rows, err = tx.Query(ctx,
			`select d.username, coalesce(d.display_name, '') from blocks b join user_directory d on d.id = b.blocked
			 where b.blocker = $1::uuid order by b.created_at desc`, me.ID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var p Person
			if err := rows.Scan(&p.Username, &p.DisplayName); err != nil {
				return err
			}
			out.Blocked = append(out.Blocked, p)
		}
		return rows.Err()
	})
	return out, err
}

// find resolves a username the signed in user is allowed to see. Anyone who blocked them is invisible.
func find(ctx context.Context, tx pgx.Tx, handle string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `select id::text from user_directory where username = $1`, handle).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrUserNotFound
	}
	return id, err
}

func exists(ctx context.Context, tx pgx.Tx, sql string, args ...any) (bool, error) {
	var found bool
	err := tx.QueryRow(ctx, `select exists (`+sql+`)`, args...).Scan(&found)
	return found, err
}

func befriend(ctx context.Context, tx pgx.Tx, me, other string) error {
	low, high := orderedPair(me, other)
	if _, err := tx.Exec(ctx, `insert into friendships (user_low, user_high) values ($1::uuid, $2::uuid) on conflict do nothing`, low, high); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`delete from friend_requests where (from_user = $1::uuid and to_user = $2::uuid) or (from_user = $2::uuid and to_user = $1::uuid)`,
		me, other)
	return err
}

// SendRequest asks someone to be friends. If they already asked first, it simply makes you friends.
func (s *Service) SendRequest(ctx context.Context, me auth.User, rawUsername string) (string, error) {
	if err := ready(me); err != nil {
		return "", err
	}
	handle, ok := normalizeUsername(rawUsername)
	if !ok {
		return "", ErrUserNotFound
	}
	if handle == me.Username {
		return "", ErrSelf
	}

	var result string
	var targetID string
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID, LookupUsername: handle}, func(tx pgx.Tx) error {
		other, err := find(ctx, tx, handle)
		if err != nil {
			return err
		}
		if blocked, err := exists(ctx, tx, `select 1 from blocks where blocker = $1::uuid and blocked = $2::uuid`, me.ID, other); err != nil || blocked {
			return errors.Join(err, errorIf(blocked, ErrYouBlocked))
		}
		low, high := orderedPair(me.ID, other)
		if friends, err := exists(ctx, tx, `select 1 from friendships where user_low = $1::uuid and user_high = $2::uuid`, low, high); err != nil || friends {
			return errors.Join(err, errorIf(friends, ErrAlreadyFriends))
		}
		if incoming, err := exists(ctx, tx, `select 1 from friend_requests where from_user = $1::uuid and to_user = $2::uuid`, other, me.ID); err != nil {
			return err
		} else if incoming {
			result = RequestBecameFriend
			return befriend(ctx, tx, me.ID, other)
		}
		if pending, err := exists(ctx, tx, `select 1 from friend_requests where from_user = $1::uuid and to_user = $2::uuid`, me.ID, other); err != nil {
			return err
		} else if pending {
			result = RequestAlreadySent
			return nil
		}

		var outgoing, today, friends int
		if err := tx.QueryRow(ctx,
			`select
			   (select count(*) from friend_requests where from_user = $1::uuid),
			   (select count(*) from friend_requests where from_user = $1::uuid and created_at > $2),
			   (select count(*) from friendships where user_low = $1::uuid or user_high = $1::uuid)`,
			me.ID, s.now().Add(-24*time.Hour),
		).Scan(&outgoing, &today, &friends); err != nil {
			return err
		}
		if outgoing >= maxPendingOutgoing || today >= maxRequestsPerDay || friends >= maxFriends {
			return ErrTooMany
		}

		result = RequestSent
		targetID = other
		_, err = tx.Exec(ctx, `insert into friend_requests (from_user, to_user) values ($1::uuid, $2::uuid)`, me.ID, other)
		return err
	})
	if err == nil && result == RequestSent {
		name := me.DisplayName
		if name == "" {
			name = me.Username
		}
		s.ping(me.ID, []string{targetID}, s.site.AppName, name+" sent you a friend request", "/")
	}
	return result, err
}

func errorIf(condition bool, err error) error {
	if condition {
		return err
	}
	return nil
}

func (s *Service) AcceptRequest(ctx context.Context, me auth.User, rawUsername string) error {
	if err := ready(me); err != nil {
		return err
	}
	handle, ok := normalizeUsername(rawUsername)
	if !ok {
		return ErrNoRequest
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		other, err := find(ctx, tx, handle)
		if errors.Is(err, ErrUserNotFound) {
			return ErrNoRequest
		}
		if err != nil {
			return err
		}
		incoming, err := exists(ctx, tx, `select 1 from friend_requests where from_user = $1::uuid and to_user = $2::uuid`, other, me.ID)
		if err != nil {
			return err
		}
		if !incoming {
			return ErrNoRequest
		}
		return befriend(ctx, tx, me.ID, other)
	})
}

// RemoveRequest declines a request someone sent you, or cancels one you sent.
func (s *Service) RemoveRequest(ctx context.Context, me auth.User, rawUsername string) error {
	handle, ok := normalizeUsername(rawUsername)
	if !ok {
		return ErrNoRequest
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		other, err := find(ctx, tx, handle)
		if errors.Is(err, ErrUserNotFound) {
			return ErrNoRequest
		}
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx,
			`delete from friend_requests where (from_user = $1::uuid and to_user = $2::uuid) or (from_user = $2::uuid and to_user = $1::uuid)`,
			me.ID, other)
		if err == nil && tag.RowsAffected() == 0 {
			return ErrNoRequest
		}
		return err
	})
}

func (s *Service) Unfriend(ctx context.Context, me auth.User, rawUsername string) error {
	handle, ok := normalizeUsername(rawUsername)
	if !ok {
		return ErrNotFriends
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		other, err := find(ctx, tx, handle)
		if errors.Is(err, ErrUserNotFound) {
			return ErrNotFriends
		}
		if err != nil {
			return err
		}
		low, high := orderedPair(me.ID, other)
		tag, err := tx.Exec(ctx, `delete from friendships where user_low = $1::uuid and user_high = $2::uuid`, low, high)
		if err == nil && tag.RowsAffected() == 0 {
			return ErrNotFriends
		}
		return err
	})
}

// Block removes any friendship or request between you and the other person, and stops them
// from finding you, sending you requests, or adding you to meetups.
func (s *Service) Block(ctx context.Context, me auth.User, rawUsername string) error {
	handle, ok := normalizeUsername(rawUsername)
	if !ok {
		return ErrUserNotFound
	}
	if handle == me.Username {
		return ErrSelf
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID, LookupUsername: handle}, func(tx pgx.Tx) error {
		other, err := find(ctx, tx, handle)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into blocks (blocker, blocked) values ($1::uuid, $2::uuid) on conflict do nothing`, me.ID, other); err != nil {
			return err
		}
		low, high := orderedPair(me.ID, other)
		if _, err := tx.Exec(ctx, `delete from friendships where user_low = $1::uuid and user_high = $2::uuid`, low, high); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`delete from friend_requests where (from_user = $1::uuid and to_user = $2::uuid) or (from_user = $2::uuid and to_user = $1::uuid)`,
			me.ID, other); err != nil {
			return err
		}
		// Leave any meetup they host, and drop them from any meetup you host.
		_, err = tx.Exec(ctx,
			`delete from meetup_members
			 where (user_id = $1::uuid and meetup_id in (select id from meetups where host_id = $2::uuid))
			    or (user_id = $2::uuid and meetup_id in (select id from meetups where host_id = $1::uuid))`,
			me.ID, other)
		return err
	})
}

func (s *Service) Unblock(ctx context.Context, me auth.User, rawUsername string) error {
	handle, ok := normalizeUsername(rawUsername)
	if !ok {
		return ErrUserNotFound
	}
	return db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		other, err := find(ctx, tx, handle)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `delete from blocks where blocker = $1::uuid and blocked = $2::uuid`, me.ID, other)
		return err
	})
}
