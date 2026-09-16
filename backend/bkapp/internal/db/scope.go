package db

import (
	"context"
	"encoding/hex"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// APIRole is the restricted role from migrations/0002_row_level_security.sql.
const APIRole = "csimap_api"

// Scope names the only rows a transaction may touch. Row level security enforces it in the database.
type Scope struct {
	EmailIndex     []byte
	TokenHash      []byte
	UserID         string
	LookupUsername string
	Maintenance    bool
}

// WithScope runs fn in a transaction that has dropped to the restricted role with the scope applied.
// Every setting is transaction local, so it ends at commit and never leaks to the next request,
// even through Neon's pooled connections.
func WithScope(ctx context.Context, pool *pgxpool.Pool, sc Scope, fn func(tx pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		maintenance := ""
		if sc.Maintenance {
			maintenance = "on"
		}
		if _, err := tx.Exec(ctx,
			`select set_config('role', $1, true),
			        set_config('app.email_index', $2, true),
			        set_config('app.token_hash', $3, true),
			        set_config('app.user_id', $4, true),
			        set_config('app.lookup_username', $5, true),
			        set_config('app.maintenance', $6, true)`,
			APIRole, hex.EncodeToString(sc.EmailIndex), hex.EncodeToString(sc.TokenHash), sc.UserID, sc.LookupUsername, maintenance,
		); err != nil {
			return err
		}
		return fn(tx)
	})
}
