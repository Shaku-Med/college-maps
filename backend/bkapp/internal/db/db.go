package db

import (
	"context"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"csimap/bkapp/migrations"
)

// Any fixed number works; it only has to be unique to this app's migrations.
const migrationLockID = 727_001

func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	// Neon's free tier allows few connections, and an idle pool lets the compute scale to zero.
	cfg.MaxConns = 5
	cfg.MinConns = 0
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("reach database: %w", err)
	}
	return pool, nil
}

type migration struct {
	version int
	name    string
	sql     string
}

func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrations.Files, ".")
	if err != nil {
		return nil, err
	}
	var list []migration
	for _, entry := range entries {
		prefix, _, ok := strings.Cut(entry.Name(), "_")
		version, err := strconv.Atoi(prefix)
		if !ok || err != nil || version <= 0 {
			return nil, fmt.Errorf("migration %q must start with a number like 0002_", entry.Name())
		}
		body, err := migrations.Files.ReadFile(entry.Name())
		if err != nil {
			return nil, err
		}
		list = append(list, migration{version: version, name: entry.Name(), sql: string(body)})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].version < list[j].version })
	for i := 1; i < len(list); i++ {
		if list[i].version == list[i-1].version {
			return nil, fmt.Errorf("two migrations share version %d", list[i].version)
		}
	}
	return list, nil
}

// Migrate applies pending SQL files in one transaction and returns the names it ran.
// The lock is transaction scoped because Neon's pooled connections do not keep session locks.
func Migrate(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	list, err := loadMigrations()
	if err != nil {
		return nil, err
	}

	var applied []string
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "select pg_advisory_xact_lock($1)", migrationLockID); err != nil {
			return fmt.Errorf("lock migrations: %w", err)
		}
		if _, err := tx.Exec(ctx, `create table if not exists schema_migrations (
			version integer primary key,
			name text not null,
			applied_at timestamptz not null default now()
		)`); err != nil {
			return fmt.Errorf("create schema_migrations: %w", err)
		}

		for _, m := range list {
			var exists bool
			if err := tx.QueryRow(ctx, "select exists (select 1 from schema_migrations where version = $1)", m.version).Scan(&exists); err != nil {
				return err
			}
			if exists {
				continue
			}
			if _, err := tx.Exec(ctx, m.sql); err != nil {
				return fmt.Errorf("migration %s: %w", m.name, err)
			}
			if _, err := tx.Exec(ctx, "insert into schema_migrations (version, name) values ($1, $2)", m.version, m.name); err != nil {
				return err
			}
			applied = append(applied, m.name)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return applied, nil
}
