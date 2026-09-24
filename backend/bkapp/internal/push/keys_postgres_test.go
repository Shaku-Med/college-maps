package push

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/db"
)

// Runs against a real database only when TEST_DATABASE_URL is set. It works on rows of its own and deletes
// them, and never reads or writes the "vapid" row the running server uses.
func TestNotificationKeysLiveInTheDatabase(t *testing.T) {
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
	testRow := func() string {
		suffix := make([]byte, 6)
		_, _ = rand.Read(suffix)
		row := "test_" + hex.EncodeToString(suffix)
		t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `delete from app_keys where name = $1`, row) })
		return row
	}
	secret := []byte(strings.Repeat("k", 40))

	// Two instances starting at the same moment settle on one keypair.
	row := testRow()
	configs := make([]config.Config, 2)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range configs {
		configs[i] = config.Config{AuthSecret: secret}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = resolveKeys(ctx, pool, &configs[i], row)
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("instance %d: %v", i, err)
		}
		if !configs[i].PushAvailable {
			t.Fatalf("instance %d: notifications stayed off", i)
		}
	}
	if configs[0].VAPIDPublic != configs[1].VAPIDPublic || configs[0].VAPIDPrivate != configs[1].VAPIDPrivate {
		t.Fatal("two instances ended up with different keys")
	}

	// A restart reads the same keys back.
	restarted := config.Config{AuthSecret: secret}
	if err := resolveKeys(ctx, pool, &restarted, row); err != nil || restarted.VAPIDPublic != configs[0].VAPIDPublic {
		t.Fatalf("keys changed across a restart: %v", err)
	}

	// The database only ever holds them sealed.
	var sealed []byte
	if err := pool.QueryRow(ctx, `select sealed from app_keys where name = $1`, row).Scan(&sealed); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(sealed), configs[0].VAPIDPrivate) || strings.Contains(string(sealed), "private") {
		t.Fatal("the private key is readable in the database")
	}

	// With a different AUTH_SECRET the keys stay put and notifications stay off.
	changed := config.Config{AuthSecret: []byte(strings.Repeat("z", 40))}
	if err := resolveKeys(ctx, pool, &changed, row); !errors.Is(err, ErrKeysUnreadable) || changed.PushAvailable {
		t.Fatalf("a changed secret gave %v, available %v", err, changed.PushAvailable)
	}
	var after []byte
	if err := pool.QueryRow(ctx, `select sealed from app_keys where name = $1`, row).Scan(&after); err != nil || string(after) != string(sealed) {
		t.Fatal("the stored keys were replaced")
	}

	// Keys already configured on a machine seed an empty database, so their subscriptions keep working.
	public, private, err := config.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	seeded := config.Config{AuthSecret: secret, VAPIDPublic: public, VAPIDPrivate: private, VAPIDSubject: "mailto:ops@example.com"}
	seedRow := testRow()
	if err := resolveKeys(ctx, pool, &seeded, seedRow); err != nil || seeded.VAPIDPublic != public {
		t.Fatalf("configured keys were not used to seed: %v", err)
	}

	// The API's restricted role cannot read them at all.
	err = db.WithScope(ctx, pool, db.Scope{UserID: "00000000-0000-0000-0000-000000000000"}, func(tx pgx.Tx) error {
		var n int
		return tx.QueryRow(ctx, `select count(*) from app_keys`).Scan(&n)
	})
	if err == nil {
		t.Fatal("the API role could read app_keys")
	}
}
