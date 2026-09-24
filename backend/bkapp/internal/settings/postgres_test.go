package settings_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/auth/authtest"
	"csimap/bkapp/internal/db"
	"csimap/bkapp/internal/settings"
)

// Runs against a real database only when TEST_DATABASE_URL is set, and removes the accounts it creates.
// It proves a student can only ever read and change their own settings.
func TestSettingsBelongToTheirOwner(t *testing.T) {
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
	t.Cleanup(pool.Close)
	if _, err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}

	mail := &authtest.CapturedMail{}
	accounts, err := auth.NewService(auth.NewPostgresStore(pool), mail, []byte(strings.Repeat("s", 40)), []string{"stu-mail.csi.cuny.edu"})
	if err != nil {
		t.Fatal(err)
	}
	signIn := func(email string) auth.User {
		if err := accounts.RequestCode(ctx, email); err != nil {
			t.Fatal(err)
		}
		user, _, err := accounts.VerifyCode(ctx, email, mail.Last(email))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = accounts.DeleteAccount(context.Background(), user) })
		return user
	}
	alice := signIn("settings.alice.test@stu-mail.csi.cuny.edu")
	bob := signIn("settings.bob.test@stu-mail.csi.cuny.edu")

	service := settings.NewService(pool)
	if got, err := service.Get(ctx, alice); err != nil || got.Voice != "" {
		t.Fatalf("new account settings = %+v, %v", got, err)
	}
	if _, err := service.Save(ctx, alice, settings.Settings{Voice: "af_bella"}); err != nil {
		t.Fatal(err)
	}
	if got, _ := service.Get(ctx, alice); got.Voice != "af_bella" {
		t.Fatalf("saved voice = %q", got.Voice)
	}
	if got, _ := service.Get(ctx, bob); got.Voice != "" {
		t.Fatalf("bob sees a voice he never chose: %q", got.Voice)
	}
	if _, err := service.Save(ctx, alice, settings.Settings{Voice: "not_a_voice"}); !errors.Is(err, settings.ErrInvalidVoice) {
		t.Fatalf("unknown voice = %v", err)
	}

	// Acting as bob with the restricted role, alice's row is invisible and cannot be changed.
	err = db.WithScope(ctx, pool, db.Scope{UserID: bob.ID}, func(tx pgx.Tx) error {
		var seen int
		if err := tx.QueryRow(ctx, `select count(*) from user_settings where user_id = $1::uuid`, alice.ID).Scan(&seen); err != nil {
			return err
		}
		if seen != 0 {
			t.Errorf("bob can see alice's settings")
		}
		tag, err := tx.Exec(ctx, `update user_settings set voice = 'bm_george' where user_id = $1::uuid`, alice.ID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 0 {
			t.Errorf("bob changed alice's settings")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// Writing a row in someone else's name is refused outright.
	err = db.WithScope(ctx, pool, db.Scope{UserID: bob.ID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `insert into user_settings (user_id, voice) values ($1::uuid, 'bm_george')
			on conflict (user_id) do update set voice = excluded.voice`, alice.ID)
		return err
	})
	if err == nil {
		t.Errorf("bob wrote a settings row for alice")
	}
	// The database refuses a value outside the list even if the API check were ever skipped.
	err = db.WithScope(ctx, pool, db.Scope{UserID: alice.ID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `update user_settings set voice = '../etc' where user_id = $1::uuid`, alice.ID)
		return err
	})
	if err == nil {
		t.Errorf("the database accepted a voice outside the list")
	}
	if got, _ := service.Get(ctx, alice); got.Voice != "af_bella" {
		t.Fatalf("alice's voice changed to %q", got.Voice)
	}

	// Deleting the account takes its settings with it.
	if err := accounts.DeleteAccount(ctx, alice); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := pool.QueryRow(ctx, `select count(*) from user_settings where user_id = $1::uuid`, alice.ID).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("settings outlived the account")
	}
}
