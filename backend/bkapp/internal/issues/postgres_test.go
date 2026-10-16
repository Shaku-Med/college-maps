package issues_test

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
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/db"
	"csimap/bkapp/internal/issues"
)

// Runs against a real database only when TEST_DATABASE_URL is set, and removes the accounts it creates.
func TestIssueReportsStayWithTheirReporter(t *testing.T) {
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
	alice := signIn("issues.alice.test@stu-mail.csi.cuny.edu")
	bob := signIn("issues.bob.test@stu-mail.csi.cuny.edu")

	service := issues.NewService(pool, &campus.Campus{Places: []campus.Place{{ID: "1N", Name: "Physics and Astronomy"}}})
	good := issues.Report{Kind: "map", Message: "The entrance to 1N is on the other side.", PlaceID: "1N", Platform: "ios", AppVersion: "1.3.0"}
	if err := service.File(ctx, alice, good); err != nil {
		t.Fatalf("a good report = %v", err)
	}

	var bad *issues.InvalidError
	for name, report := range map[string]issues.Report{
		"unknown kind":    {Kind: "spam", Message: good.Message, Platform: "web"},
		"short message":   {Kind: "bug", Message: "broken", Platform: "web"},
		"long message":    {Kind: "bug", Message: strings.Repeat("a", 1001), Platform: "web"},
		"control char":    {Kind: "bug", Message: "it breaks \x07 here sometimes", Platform: "web"},
		"unknown place":   {Kind: "map", Message: good.Message, PlaceID: "9Z", Platform: "web"},
		"bad version":     {Kind: "bug", Message: good.Message, Platform: "ios", AppVersion: "1.3.0'; drop"},
		"unknown sender":  {Kind: "bug", Message: good.Message, Platform: "desktop"},
		"signed out user": {Kind: "bug", Message: good.Message, Platform: "web"},
	} {
		who := alice
		if name == "signed out user" {
			who = auth.User{}
		}
		err := service.File(ctx, who, report)
		if name == "signed out user" {
			if !errors.Is(err, auth.ErrUnauthorized) {
				t.Errorf("%s = %v", name, err)
			}
			continue
		}
		if !errors.As(err, &bad) {
			t.Errorf("%s = %v, want a reason to show", name, err)
		}
	}

	// Ten a day, counted in the database: alice has one already.
	for i := 0; i < 9; i++ {
		if err := service.File(ctx, alice, good); err != nil {
			t.Fatalf("report %d = %v", i+2, err)
		}
	}
	if err := service.File(ctx, alice, good); !errors.Is(err, issues.ErrTooMany) {
		t.Fatalf("the eleventh report = %v", err)
	}
	if err := service.File(ctx, bob, good); err != nil {
		t.Fatalf("alice's cap stopped bob: %v", err)
	}

	// Acting as bob with the restricted role, alice's reports are invisible and cannot be written in her name.
	err = db.WithScope(ctx, pool, db.Scope{UserID: bob.ID}, func(tx pgx.Tx) error {
		var seen int
		if err := tx.QueryRow(ctx, `select count(*) from issue_reports where reporter_id = $1::uuid`, alice.ID).Scan(&seen); err != nil {
			return err
		}
		if seen != 0 {
			t.Errorf("bob can see alice's reports")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	err = db.WithScope(ctx, pool, db.Scope{UserID: bob.ID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `insert into issue_reports (reporter_id, kind, message, platform) values ($1::uuid, 'bug', 'written as someone else', 'web')`, alice.ID)
		return err
	})
	if err == nil {
		t.Errorf("bob filed a report as alice")
	}

	// Deleting the account takes its reports with it.
	if err := accounts.DeleteAccount(ctx, alice); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := pool.QueryRow(ctx, `select count(*) from issue_reports where reporter_id = $1::uuid`, alice.ID).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("%d reports outlived alice's account", left)
	}
}
