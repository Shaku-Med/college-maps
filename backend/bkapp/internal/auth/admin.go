package auth

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Account is a full user record for the app owner, with the email decrypted. It is only produced
// for server-side tools and must never be returned from the public API.
type Account struct {
	// Unreadable marks a row sealed under a different AUTH_SECRET, such as after the secret was replaced.
	Unreadable  bool
	Email       string
	Username    string
	DisplayName string
	CreatedAt   time.Time
	LastLoginAt *time.Time
}

// Admin reads accounts with the same keys the API uses, so whoever holds AUTH_SECRET and the
// database URL can always get every email back. The database alone cannot.
type Admin struct {
	pool *pgxpool.Pool
	keys *Keys
}

func NewAdmin(pool *pgxpool.Pool, secret []byte) (*Admin, error) {
	keys, err := DeriveKeys(secret)
	if err != nil {
		return nil, err
	}
	return &Admin{pool: pool, keys: keys}, nil
}

func (a *Admin) scan(rows pgx.Rows) ([]Account, error) {
	var accounts []Account
	for rows.Next() {
		var stored StoredUser
		var account Account
		if err := rows.Scan(&stored.ID, &stored.EmailIndex, &stored.EmailSealed, &stored.Username, &stored.DisplayName, &account.CreatedAt, &account.LastLoginAt); err != nil {
			return nil, err
		}
		if email, err := a.keys.openEmail(stored.EmailSealed, stored.EmailIndex); err == nil {
			account.Email = email
		} else {
			account.Unreadable = true
		}
		account.Username = stored.Username
		account.DisplayName = stored.DisplayName
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (a *Admin) List(ctx context.Context) ([]Account, error) {
	rows, err := a.pool.Query(ctx, `select `+userColumns+`, u.created_at, u.last_login_at from users u order by u.created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return a.scan(rows)
}

// Find looks an account up by email through the blind index, without scanning every row.
func (a *Admin) Find(ctx context.Context, email string) (*Account, error) {
	rows, err := a.pool.Query(ctx,
		`select `+userColumns+`, u.created_at, u.last_login_at from users u where u.email_index = $1`,
		a.keys.EmailIndex(email),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts, err := a.scan(rows)
	if err != nil || len(accounts) == 0 {
		return nil, err
	}
	return &accounts[0], nil
}
