package auth_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	. "csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/auth/authtest"
	"csimap/bkapp/internal/db"
)

// Runs against a real database only when TEST_DATABASE_URL is set, and removes the rows it creates.
func TestPostgresStoreFlow(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run against Postgres")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	pool, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	// Registered first so it runs last: cleanups run in reverse, after the test body returns.
	t.Cleanup(pool.Close)
	if _, err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}

	suffix := make([]byte, 6)
	_, _ = rand.Read(suffix)
	email := "itest." + hex.EncodeToString(suffix) + "@stu-mail.csi.cuny.edu"
	rival := "rival." + hex.EncodeToString(suffix) + "@stu-mail.csi.cuny.edu"
	var index, rivalIndex []byte
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 20*time.Second)
		defer done()
		for _, idx := range [][]byte{index, rivalIndex} {
			if _, err := pool.Exec(cleanup, "delete from users where email_index = $1", idx); err != nil {
				t.Errorf("cleanup users: %v", err)
			}
			if _, err := pool.Exec(cleanup, "delete from login_codes where email_index = $1", idx); err != nil {
				t.Errorf("cleanup codes: %v", err)
			}
		}
	})

	mail := &authtest.CapturedMail{}
	svc, err := NewService(NewPostgresStore(pool), mail, []byte(strings.Repeat("k", 40)), []string{"stu-mail.csi.cuny.edu"})
	if err != nil {
		t.Fatal(err)
	}
	index = svc.EmailIndex(email)
	rivalIndex = svc.EmailIndex(rival)

	if err := svc.RequestCode(ctx, email); err != nil {
		t.Fatal(err)
	}
	var limited *RateLimitError
	if err := svc.RequestCode(ctx, email); !errors.As(err, &limited) {
		t.Fatalf("cooldown not enforced: %v", err)
	}

	code := mail.Last(email)
	wrong := "00000000"
	if code == wrong {
		wrong = "11111111"
	}
	if _, _, err := svc.VerifyCode(ctx, email, wrong); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("wrong code: %v", err)
	}

	user, token, err := svc.VerifyCode(ctx, email, code)
	if err != nil || user.Email != email || !user.NeedsProfile() {
		t.Fatalf("verify: %+v %v", user, err)
	}
	var leftover int
	if err := pool.QueryRow(ctx, "select count(*) from login_codes where email_index = $1", index).Scan(&leftover); err != nil || leftover != 0 {
		t.Fatalf("codes should be deleted after signing in, found %d: %v", leftover, err)
	}
	if _, _, err := svc.VerifyCode(ctx, email, code); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("code reused")
	}

	authed, err := svc.Authenticate(ctx, token)
	if err != nil || authed.Email != email {
		t.Fatalf("authenticate: %v", err)
	}
	// A handle made from the email would be refused, so it gets its own random part.
	handleSuffix := make([]byte, 6)
	_, _ = rand.Read(handleSuffix)
	handle := "tester_" + hex.EncodeToString(handleSuffix)
	named, err := svc.UpdateProfile(ctx, authed, &[]string{"Integration Test"}[0], &handle)
	if err != nil || named.DisplayName != "Integration Test" || named.Username != handle {
		t.Fatalf("profile: %+v %v", named, err)
	}

	var stored int
	if err := pool.QueryRow(ctx, "select count(*) from users where email_index = $1 and position(convert_to($2, 'UTF8') in email_sealed) = 0", index, email).Scan(&stored); err != nil || stored != 1 {
		t.Fatalf("row should exist with an encrypted email: %d %v", stored, err)
	}
	admin, err := NewAdmin(pool, []byte(strings.Repeat("k", 40)))
	if err != nil {
		t.Fatal(err)
	}
	found, err := admin.Find(ctx, email)
	if err != nil || found == nil || found.Email != email || found.Username != handle {
		t.Fatalf("owner lookup should return the decrypted email: %+v %v", found, err)
	}

	if err := svc.RequestCode(ctx, rival); err != nil {
		t.Fatal(err)
	}
	rivalUser, rivalToken, err := svc.VerifyCode(ctx, rival, mail.Last(rival))
	if err != nil {
		t.Fatal(err)
	}
	checkRowLevelSecurity(t, ctx, pool, index, rivalIndex)
	if _, err := svc.UpdateProfile(ctx, rivalUser, nil, &handle); !errors.Is(err, ErrUsernameUnavailable) {
		t.Fatalf("duplicate username must be refused by the database: %v", err)
	}
	if err := svc.SignOutEverywhere(ctx, rivalUser); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, rivalToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("sign out everywhere left a session")
	}

	if err := svc.SignOut(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("session survived sign out")
	}
	if err := svc.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}

	// An account that never finished setup is removed after two days; a finished one stays.
	if _, err := pool.Exec(ctx, "update users set created_at = now() - interval '3 days' where email_index = any($1)", [][]byte{index, rivalIndex}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var expiredSessions int
	_ = pool.QueryRow(ctx, "select count(*) from sessions where expires_at <= now() or last_seen_at <= now() - interval '14 days'").Scan(&expiredSessions)
	if expiredSessions != 0 {
		t.Errorf("cleanup left %d expired sessions", expiredSessions)
	}
	var finished, unfinished int
	_ = pool.QueryRow(ctx, "select count(*) from users where email_index = $1", index).Scan(&finished)
	_ = pool.QueryRow(ctx, "select count(*) from users where email_index = $1", rivalIndex).Scan(&unfinished)
	if finished != 1 || unfinished != 0 {
		t.Fatalf("cleanup kept finished=%d unfinished=%d, want 1 and 0", finished, unfinished)
	}

	if err := svc.DeleteAccount(ctx, named); err != nil {
		t.Fatal(err)
	}
	var leftoverUsers, leftoverCodes, leftoverSessions int
	_ = pool.QueryRow(ctx, "select count(*) from users where email_index = $1", index).Scan(&leftoverUsers)
	_ = pool.QueryRow(ctx, "select count(*) from login_codes where email_index = $1", index).Scan(&leftoverCodes)
	_ = pool.QueryRow(ctx, "select count(*) from sessions where user_id = $1::uuid", named.ID).Scan(&leftoverSessions)
	if leftoverUsers != 0 || leftoverCodes != 0 || leftoverSessions != 0 {
		t.Fatalf("delete left users=%d codes=%d sessions=%d", leftoverUsers, leftoverCodes, leftoverSessions)
	}
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("session survived account delete")
	}
}

// checkRowLevelSecurity acts as the API role directly, the way a bug or injected SQL would.
func checkRowLevelSecurity(t *testing.T, ctx context.Context, pool *pgxpool.Pool, victimIndex, attackerIndex []byte) {
	t.Helper()
	asAPI := func(emailIndex []byte, maintenance string, fn func(tx pgx.Tx) error) error {
		return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx,
				`select set_config('role', 'csimap_api', true), set_config('app.email_index', $1, true), set_config('app.maintenance', $2, true)`,
				hex.EncodeToString(emailIndex), maintenance,
			); err != nil {
				return err
			}
			return fn(tx)
		})
	}
	count := func(tx pgx.Tx, query string, args ...any) int {
		var n int
		if err := tx.QueryRow(ctx, query, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		return n
	}

	_ = asAPI(nil, "", func(tx pgx.Tx) error {
		for _, table := range []string{"users", "sessions", "login_codes"} {
			if n := count(tx, "select count(*) from "+table); n != 0 {
				t.Errorf("without a scope the API role saw %d rows in %s", n, table)
			}
		}
		return nil
	})

	_ = asAPI(attackerIndex, "", func(tx pgx.Tx) error {
		if n := count(tx, "select count(*) from users where email_index = $1", victimIndex); n != 0 {
			t.Error("one email's scope could read another account")
		}
		if n := count(tx, "select count(*) from users"); n != 1 {
			t.Errorf("an email's scope should see exactly its own account, saw %d", n)
		}
		tag, err := tx.Exec(ctx, "update users set display_name = 'hacked' where email_index = $1", victimIndex)
		if err != nil || tag.RowsAffected() != 0 {
			t.Errorf("one scope changed another account: %v %d", err, tag.RowsAffected())
		}
		tag, err = tx.Exec(ctx, "delete from users where email_index = $1", victimIndex)
		if err != nil || tag.RowsAffected() != 0 {
			t.Errorf("one scope deleted another account: %v %d", err, tag.RowsAffected())
		}
		return nil
	})

	if err := asAPI(nil, "", func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "select count(*) from schema_migrations")
		return err
	}); err == nil {
		t.Error("the API role must not read schema_migrations")
	}

	_ = asAPI(nil, "on", func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, "delete from login_codes")
		if err != nil || tag.RowsAffected() != 0 {
			t.Errorf("cleanup deleted live codes: %v %d", err, tag.RowsAffected())
		}
		return nil
	})
}
