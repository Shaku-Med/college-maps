package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"csimap/bkapp/internal/db"
)

// Sessions only need their last_seen_at refreshed occasionally, not on every request.
const touchInterval = time.Hour

const userColumns = `u.id::text, u.email_index, u.email_sealed, coalesce(u.username, ''), coalesce(u.display_name, '')`

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{pool: pool}
}

func scanUser(row pgx.Row, extra ...any) (StoredUser, error) {
	var u StoredUser
	dest := append([]any{&u.ID, &u.EmailIndex, &u.EmailSealed, &u.Username, &u.DisplayName}, extra...)
	err := row.Scan(dest...)
	return u, err
}

func (p *PostgresStore) CodeStats(ctx context.Context, emailIndex []byte, since time.Time) (int, time.Time, error) {
	var count int
	var latest *time.Time
	err := db.WithScope(ctx, p.pool, db.Scope{EmailIndex: emailIndex}, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`select count(*), max(created_at) from login_codes where email_index = $1 and created_at >= $2`,
			emailIndex, since,
		).Scan(&count, &latest)
	})
	if err != nil || latest == nil {
		return count, time.Time{}, err
	}
	return count, *latest, nil
}

// ReplaceCode retires any unused code for the email so only the newest one can ever work.
func (p *PostgresStore) ReplaceCode(ctx context.Context, emailIndex, hash []byte, expiresAt time.Time) error {
	return db.WithScope(ctx, p.pool, db.Scope{EmailIndex: emailIndex}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx,
			`update login_codes set consumed_at = now() where email_index = $1 and consumed_at is null`, emailIndex,
		); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`insert into login_codes (email_index, code_hash, expires_at) values ($1, $2, $3)`, emailIndex, hash, expiresAt,
		)
		return err
	})
}

// CheckCode locks the code row so parallel guesses are counted one at a time.
// A correct code deletes every code for the email, so nothing reusable stays in the database.
func (p *PostgresStore) CheckCode(ctx context.Context, emailIndex []byte, now time.Time, maxAttempts int, matches func([]byte) bool) (VerifyOutcome, int, error) {
	outcome := CodeMissing
	left := 0
	err := db.WithScope(ctx, p.pool, db.Scope{EmailIndex: emailIndex}, func(tx pgx.Tx) error {
		var id int64
		var hash []byte
		var attempts int
		err := tx.QueryRow(ctx,
			`select id, code_hash, attempts from login_codes
			 where email_index = $1 and consumed_at is null and expires_at > $2
			 order by created_at desc limit 1
			 for update`,
			emailIndex, now,
		).Scan(&id, &hash, &attempts)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}

		if attempts >= maxAttempts {
			outcome = CodeLocked
			_, err := tx.Exec(ctx, `update login_codes set consumed_at = $2 where id = $1`, id, now)
			return err
		}
		if !matches(hash) {
			outcome = CodeMismatch
			left = maxAttempts - attempts - 1
			locked := left <= 0
			_, err := tx.Exec(ctx,
				`update login_codes set attempts = attempts + 1, consumed_at = case when $2 then $3 else consumed_at end where id = $1`,
				id, locked, now,
			)
			return err
		}
		outcome = CodeAccepted
		_, err = tx.Exec(ctx, `delete from login_codes where email_index = $1`, emailIndex)
		return err
	})
	return outcome, left, err
}

func (p *PostgresStore) UpsertUser(ctx context.Context, emailIndex, emailSealed []byte, now time.Time) (StoredUser, error) {
	var user StoredUser
	err := db.WithScope(ctx, p.pool, db.Scope{EmailIndex: emailIndex}, func(tx pgx.Tx) (err error) {
		user, err = scanUser(tx.QueryRow(ctx,
			`insert into users as u (email_index, email_sealed, last_login_at) values ($1, $2, $3)
			 on conflict (email_index) do update set last_login_at = excluded.last_login_at
			 returning `+userColumns,
			emailIndex, emailSealed, now,
		))
		return err
	})
	return user, err
}

func (p *PostgresStore) CreateSession(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	return db.WithScope(ctx, p.pool, db.Scope{UserID: userID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`insert into sessions (token_hash, user_id, expires_at) values ($1, $2::uuid, $3)`,
			tokenHash, userID, expiresAt,
		)
		return err
	})
}

func (p *PostgresStore) SessionUser(ctx context.Context, tokenHash []byte, now, idleSince time.Time) (StoredUser, error) {
	var user StoredUser
	err := db.WithScope(ctx, p.pool, db.Scope{TokenHash: tokenHash}, func(tx pgx.Tx) error {
		var lastSeen time.Time
		var err error
		user, err = scanUser(tx.QueryRow(ctx,
			`select `+userColumns+`, s.last_seen_at
			 from sessions s join users u on u.id = s.user_id
			 where s.token_hash = $1 and s.expires_at > $2 and s.last_seen_at > $3`,
			tokenHash, now, idleSince,
		), &lastSeen)
		if err != nil {
			return err
		}
		if now.Sub(lastSeen) > touchInterval {
			_, err = tx.Exec(ctx, `update sessions set last_seen_at = $2 where token_hash = $1`, tokenHash, now)
		}
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return StoredUser{}, ErrUnauthorized
	}
	return user, err
}

func (p *PostgresStore) DeleteSession(ctx context.Context, tokenHash []byte) error {
	return db.WithScope(ctx, p.pool, db.Scope{TokenHash: tokenHash}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `delete from sessions where token_hash = $1`, tokenHash)
		return err
	})
}

func (p *PostgresStore) DeleteUserSessions(ctx context.Context, userID string) error {
	return db.WithScope(ctx, p.pool, db.Scope{UserID: userID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `delete from sessions where user_id = $1::uuid`, userID)
		return err
	})
}

func (p *PostgresStore) UpdateProfile(ctx context.Context, userID string, update ProfileUpdate) (StoredUser, error) {
	var user StoredUser
	err := db.WithScope(ctx, p.pool, db.Scope{UserID: userID}, func(tx pgx.Tx) (err error) {
		user, err = scanUser(tx.QueryRow(ctx,
			`update users as u set
			   display_name = coalesce($2, u.display_name),
			   username = coalesce($3, u.username)
			 where u.id = $1::uuid
			 returning `+userColumns,
			userID, update.DisplayName, update.Username,
		))
		return err
	})
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return StoredUser{}, ErrUnauthorized
	case errors.As(err, &pgErr) && pgErr.Code == "23505":
		return StoredUser{}, ErrUsernameUnavailable
	}
	return user, err
}

func (p *PostgresStore) DeleteAccount(ctx context.Context, userID string, _ []byte) error {
	var last error
	for attempt := 0; attempt < 8; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		last = db.WithScope(ctx, p.pool, db.Scope{UserID: userID}, func(tx pgx.Tx) error {
			var ok bool
			if err := tx.QueryRow(ctx, `select csimap_wipe_account()`).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return ErrUnauthorized
			}
			return nil
		})
		if last == nil || !isBusyWipe(last) {
			return last
		}
		timer := time.NewTimer(time.Duration(25*(attempt+1)) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return last
}

func isBusyWipe(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "40P01" || pgErr.Code == "40001")
}

func (p *PostgresStore) AccountRecord(ctx context.Context, userID string) (AccountRecord, error) {
	var rec AccountRecord
	err := db.WithScope(ctx, p.pool, db.Scope{UserID: userID}, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx,
			`select created_at, last_login_at from users where id = $1::uuid`, userID,
		).Scan(&rec.CreatedAt, &rec.LastLoginAt); err != nil {
			return err
		}
		rows, err := tx.Query(ctx,
			`select created_at, last_seen_at, expires_at from sessions where user_id = $1::uuid order by last_seen_at desc`,
			userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		rec.Sessions = []SessionRecord{}
		for rows.Next() {
			var s SessionRecord
			if err := rows.Scan(&s.CreatedAt, &s.LastSeenAt, &s.ExpiresAt); err != nil {
				return err
			}
			rec.Sessions = append(rec.Sessions, s)
		}
		return rows.Err()
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return AccountRecord{}, ErrUnauthorized
	}
	return rec, err
}

func (p *PostgresStore) DeleteExpired(ctx context.Context, now, idleSince time.Time) error {
	return db.WithScope(ctx, p.pool, db.Scope{Maintenance: true}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `delete from sessions where expires_at <= $1 or last_seen_at <= $2`, now, idleSince); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from login_codes where expires_at <= $1`, now.Add(-24*time.Hour)); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`delete from users where (username is null or display_name is null) and created_at <= $1`,
			now.Add(-IncompleteAccountTTL))
		return err
	})
}
