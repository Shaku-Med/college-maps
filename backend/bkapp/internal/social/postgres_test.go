package social_test

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

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/auth/authtest"
	"csimap/bkapp/internal/campus"
	"csimap/bkapp/internal/db"
	"csimap/bkapp/internal/social"
	"csimap/bkapp/internal/ticket"
)

var (
	authSecret   = []byte(strings.Repeat("k", 40))
	ticketSecret = []byte(strings.Repeat("t", 40))
)

func randomHex(t *testing.T, n int) string {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}

type harness struct {
	pool   *pgxpool.Pool
	auth   *auth.Service
	social *social.Service
	site   *campus.Campus
	mail   *authtest.CapturedMail
}

func (h *harness) person(t *testing.T, ctx context.Context, name string) auth.User {
	t.Helper()
	addr := "social." + randomHex(t, 5) + "@stu-mail.csi.cuny.edu"
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 20*time.Second)
		defer done()
		idx := h.auth.EmailIndex(addr)
		if _, err := h.pool.Exec(cleanup, "delete from users where email_index = $1", idx); err != nil {
			t.Errorf("cleanup: %v", err)
		}
		_, _ = h.pool.Exec(cleanup, "delete from login_codes where email_index = $1", idx)
	})
	if err := h.auth.RequestCode(ctx, addr); err != nil {
		t.Fatal(err)
	}
	user, _, err := h.auth.VerifyCode(ctx, addr, h.mail.Last(addr))
	if err != nil {
		t.Fatal(err)
	}
	display := strings.ToUpper(name[:1]) + name[1:]
	handle := name + "_" + randomHex(t, 4)
	user, err = h.auth.UpdateProfile(ctx, user, &display, &handle)
	if err != nil {
		t.Fatal(err)
	}
	return user
}

func setup(t *testing.T) (*harness, context.Context) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run against Postgres")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	pool, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	site, err := campus.Load()
	if err != nil {
		t.Fatal(err)
	}
	mail := &authtest.CapturedMail{}
	authService, err := auth.NewService(auth.NewPostgresStore(pool), mail, authSecret, site.EmailDomains)
	if err != nil {
		t.Fatal(err)
	}
	socialService, err := social.NewService(pool, site, ticketSecret)
	if err != nil {
		t.Fatal(err)
	}
	return &harness{pool: pool, auth: authService, social: socialService, site: site, mail: mail}, ctx
}

func usernames[T any](items []T, name func(T) string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		out = append(out, name(item))
	}
	return out
}

func TestFriendsAndMeetups(t *testing.T) {
	h, ctx := setup(t)
	s := h.social
	alice := h.person(t, ctx, "alice")
	bob := h.person(t, ctx, "bob")
	carol := h.person(t, ctx, "carol")
	dave := h.person(t, ctx, "dave")

	// Requests: a second send is idempotent, and asking back makes you friends.
	if got, err := s.SendRequest(ctx, alice, "@"+strings.ToUpper(bob.Username)); err != nil || got != social.RequestSent {
		t.Fatalf("send: %q %v", got, err)
	}
	if got, err := s.SendRequest(ctx, alice, bob.Username); err != nil || got != social.RequestAlreadySent {
		t.Fatalf("resend: %q %v", got, err)
	}
	bobView, err := s.Overview(ctx, bob)
	if err != nil || len(bobView.Incoming) != 1 || bobView.Incoming[0].Username != alice.Username || bobView.Incoming[0].DisplayName != "Alice" {
		t.Fatalf("bob incoming: %+v %v", bobView, err)
	}
	if got, err := s.SendRequest(ctx, bob, alice.Username); err != nil || got != social.RequestBecameFriend {
		t.Fatalf("mutual request: %q %v", got, err)
	}
	if _, err := s.SendRequest(ctx, alice, bob.Username); !errors.Is(err, social.ErrAlreadyFriends) {
		t.Fatalf("already friends: %v", err)
	}
	if _, err := s.SendRequest(ctx, alice, alice.Username); !errors.Is(err, social.ErrSelf) {
		t.Fatalf("self request: %v", err)
	}
	if _, err := s.SendRequest(ctx, alice, "nobody_"+randomHex(t, 4)); !errors.Is(err, social.ErrUserNotFound) {
		t.Fatalf("unknown user: %v", err)
	}

	if _, err := s.SendRequest(ctx, alice, carol.Username); err != nil {
		t.Fatal(err)
	}
	if err := s.AcceptRequest(ctx, carol, alice.Username); err != nil {
		t.Fatal(err)
	}
	aliceView, err := s.Overview(ctx, alice)
	if err != nil || len(aliceView.Friends) != 2 || len(aliceView.Outgoing) != 0 {
		t.Fatalf("alice overview: %+v %v", aliceView, err)
	}

	// Someone who blocked you disappears: you cannot find, request, or invite them.
	if err := s.Block(ctx, dave, alice.Username); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRequest(ctx, alice, dave.Username); !errors.Is(err, social.ErrUserNotFound) {
		t.Fatalf("blocked user should look missing: %v", err)
	}
	daveView, _ := s.Overview(ctx, dave)
	if len(daveView.Blocked) != 1 || daveView.Blocked[0].Username != alice.Username {
		t.Fatalf("dave blocked list: %+v", daveView.Blocked)
	}
	if _, err := s.SendRequest(ctx, dave, alice.Username); !errors.Is(err, social.ErrYouBlocked) {
		t.Fatalf("blocker sending request: %v", err)
	}

	checkDatabaseRules(t, ctx, h.pool, alice, dave)

	// A meetup at a campus place: invited friends see who and when, but not where until they join.
	placeID := h.site.Places[0].ID
	created, err := s.CreateMeetup(ctx, alice, social.CreateMeetup{
		Friends:     []string{bob.Username, carol.Username},
		Destination: social.DestinationInput{Kind: social.DestinationPlace, PlaceID: placeID},
		Note:        "  lunch   before class ",
		Minutes:     60,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !created.Active || created.YourRole != "host" || created.Note != "lunch before class" || created.Destination == nil || created.Destination.PlaceID != placeID || len(created.Members) != 3 {
		t.Fatalf("created meetup: %+v", created)
	}

	invite, err := s.GetMeetup(ctx, bob, created.ID)
	if err != nil || invite.YourStatus != social.StatusInvited || invite.Destination != nil || invite.YourLiveID != "" {
		t.Fatalf("bob invite should hide the place: %+v %v", invite, err)
	}
	if _, err := s.LiveTicket(ctx, bob, created.ID); !errors.Is(err, social.ErrNotJoined) {
		t.Fatalf("ticket before joining: %v", err)
	}
	if _, err := s.GetMeetup(ctx, dave, created.ID); !errors.Is(err, social.ErrMeetupNotFound) {
		t.Fatalf("outsider saw the meetup: %v", err)
	}

	joined, err := s.RespondToMeetup(ctx, bob, created.ID, true)
	if err != nil || joined.Destination == nil || joined.YourLiveID == "" {
		t.Fatalf("join: %+v %v", joined, err)
	}
	pass, err := s.LiveTicket(ctx, bob, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := ticket.Verify(ticketSecret, pass.Token, time.Now())
	if err != nil || claims.Room != created.ID || claims.Member != joined.YourLiveID || claims.Name != "Bob" {
		t.Fatalf("ticket claims: %+v %v", claims, err)
	}
	if strings.Contains(pass.Token, bob.ID) {
		t.Fatal("tickets must not carry database ids")
	}

	lists, err := s.ListMeetups(ctx, carol)
	if err != nil || len(lists) != 1 || lists[0].ID != created.ID {
		t.Fatalf("carol list: %+v %v", lists, err)
	}
	if _, err := s.RespondToMeetup(ctx, carol, created.ID, false); err != nil {
		t.Fatal(err)
	}
	if lists, _ := s.ListMeetups(ctx, carol); len(lists) != 0 {
		t.Fatal("declined meetups should leave the list")
	}
	if _, err := s.EndMeetup(ctx, bob, created.ID); !errors.Is(err, social.ErrNotHost) {
		t.Fatalf("guest ended meetup: %v", err)
	}

	// Invalid meetups.
	for name, in := range map[string]social.CreateMeetup{
		"not a friend": {Friends: []string{dave.Username}, Destination: social.DestinationInput{Kind: social.DestinationMember, Username: alice.Username}},
		"no friends":   {Friends: nil, Destination: social.DestinationInput{Kind: social.DestinationPlace, PlaceID: placeID}},
		"far pin":      {Friends: []string{bob.Username}, Destination: social.DestinationInput{Kind: social.DestinationPin, Lat: ptr(40.7128), Lng: ptr(-74.0060)}},
		"stranger dst": {Friends: []string{bob.Username}, Destination: social.DestinationInput{Kind: social.DestinationMember, Username: carol.Username}},
		"fake place":   {Friends: []string{bob.Username}, Destination: social.DestinationInput{Kind: social.DestinationPlace, PlaceID: "NOPE"}},
		"long note":    {Friends: []string{bob.Username}, Destination: social.DestinationInput{Kind: social.DestinationPlace, PlaceID: placeID}, Note: strings.Repeat("x", 81)},
	} {
		var bad *social.InvalidError
		if _, err := s.CreateMeetup(ctx, alice, in); !errors.As(err, &bad) {
			t.Errorf("%s: expected a validation error, got %v", name, err)
		}
	}

	ended, err := s.EndMeetup(ctx, alice, created.ID)
	if err != nil || ended.Active {
		t.Fatalf("end: %+v %v", ended, err)
	}
	if _, err := s.LiveTicket(ctx, bob, created.ID); !errors.Is(err, social.ErrMeetupOver) {
		t.Fatalf("ticket after end: %v", err)
	}

	// Meeting a friend where they are exposes that friend's live id to joined members only.
	followed, err := s.CreateMeetup(ctx, alice, social.CreateMeetup{
		Friends:     []string{bob.Username},
		Destination: social.DestinationInput{Kind: social.DestinationMember, Username: bob.Username},
	})
	if err != nil || followed.Destination == nil || followed.Destination.Username != bob.Username || followed.Destination.LiveID == "" {
		t.Fatalf("member destination: %+v %v", followed, err)
	}

	// Meetups that ended more than a day ago are deleted by the hourly cleanup.
	if _, err := h.pool.Exec(ctx, "update meetups set created_at = now() - interval '3 days', expires_at = now() - interval '2 days' where public_id = $1", created.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var left int
	_ = h.pool.QueryRow(ctx, "select count(*) from meetups where public_id = $1", created.ID).Scan(&left)
	if left != 0 {
		t.Fatal("cleanup kept a meetup that ended days ago")
	}
	var live int
	_ = h.pool.QueryRow(ctx, "select count(*) from meetups where public_id = $1", followed.ID).Scan(&live)
	if live != 1 {
		t.Fatal("cleanup removed an active meetup")
	}

	if err := s.Unfriend(ctx, alice, bob.Username); err != nil {
		t.Fatal(err)
	}
	if err := s.Unfriend(ctx, alice, bob.Username); !errors.Is(err, social.ErrNotFriends) {
		t.Fatalf("double unfriend: %v", err)
	}
	if got := usernames(mustOverview(t, ctx, s, alice).Friends, func(f social.Friend) string { return f.Username }); len(got) != 1 || got[0] != carol.Username {
		t.Fatalf("friends after unfriend: %v", got)
	}
}

func mustOverview(t *testing.T, ctx context.Context, s *social.Service, me auth.User) social.Overview {
	t.Helper()
	o, err := s.Overview(ctx, me)
	if err != nil {
		t.Fatal(err)
	}
	return o
}

func ptr(v float64) *float64 { return &v }

// checkDatabaseRules acts as the API role directly, the way a bug or injected SQL would.
func checkDatabaseRules(t *testing.T, ctx context.Context, pool *pgxpool.Pool, alice, dave auth.User) {
	t.Helper()
	as := func(sc db.Scope, fn func(tx pgx.Tx) error) error { return db.WithScope(ctx, pool, sc, fn) }

	_ = as(db.Scope{UserID: alice.ID}, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, "select count(*) from user_directory").Scan(&n); err != nil {
			t.Fatal(err)
		}
		if err := tx.QueryRow(ctx, "select count(*) from user_directory where username = $1", dave.Username).Scan(&n); err != nil || n != 0 {
			t.Errorf("alice could see dave, who blocked her: %d %v", n, err)
		}
		return nil
	})

	_ = as(db.Scope{}, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, "select count(*) from user_directory").Scan(&n); err != nil || n != 0 {
			t.Errorf("without a user the directory listed %d people: %v", n, err)
		}
		return nil
	})

	low, high := alice.ID, dave.ID
	if high < low {
		low, high = high, low
	}
	if err := as(db.Scope{UserID: alice.ID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "insert into friendships (user_low, user_high) values ($1::uuid, $2::uuid)", low, high)
		return err
	}); err == nil {
		t.Error("a friendship was created without an accepted request")
	}

	if err := as(db.Scope{UserID: alice.ID}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "select email_sealed from users where id = $1::uuid", dave.ID)
		return err
	}); err != nil {
		t.Fatalf("query failed: %v", err)
	}
	_ = as(db.Scope{UserID: alice.ID}, func(tx pgx.Tx) error {
		var n int
		_ = tx.QueryRow(ctx, "select count(*) from users where id <> $1::uuid", alice.ID).Scan(&n)
		if n != 0 {
			t.Errorf("alice could read %d other account rows", n)
		}
		return nil
	})
}

func TestPublicMeetups(t *testing.T) {
	h, ctx := setup(t)
	s := h.social
	host := h.person(t, ctx, "hana")
	student := h.person(t, ctx, "nate")
	placeID := h.site.Places[0].ID

	later, err := s.CreatePublicMeetup(ctx, host, social.NewPublicMeetup{
		Title:       "  Club   fair ",
		Note:        "come say hi",
		Destination: social.DestinationInput{Kind: social.DestinationPlace, PlaceID: placeID},
		StartsIn:    45,
		Minutes:     120,
	})
	if err != nil {
		t.Fatal(err)
	}
	if later.Title != "Club fair" || later.Visibility != social.VisibilityPublic || later.StartsAt == nil || later.Going != 1 {
		t.Fatalf("created: %+v", later)
	}

	// Anyone signed in sees it in the campus list, without the place before it starts.
	list, err := s.ListPublicMeetups(ctx, student)
	if err != nil {
		t.Fatal(err)
	}
	var found *social.Meetup
	for i := range list {
		if list[i].ID == later.ID {
			found = &list[i]
		}
	}
	if found == nil || found.Destination != nil || found.YourStatus != "" {
		t.Fatalf("campus list: %+v", found)
	}

	joined, err := s.JoinPublicMeetup(ctx, student, later.ID)
	if err != nil || joined.YourStatus != social.StatusJoined || joined.Going != 2 {
		t.Fatalf("join: %+v %v", joined, err)
	}
	if joined.Destination != nil {
		t.Fatal("the place must stay hidden until a public meetup starts")
	}
	if joined.YourLiveID != "" || joined.Members[0].LiveID != "" {
		t.Fatal("public meetups must not hand out live location ids")
	}
	if _, err := s.LiveTicket(ctx, student, later.ID); err == nil {
		t.Fatal("public meetups must not give out live passes")
	}

	// Once it starts, people who are going can see where.
	if _, err := h.pool.Exec(ctx, "update meetups set starts_at = now() - interval '1 minute' where public_id = $1", later.ID); err != nil {
		t.Fatal(err)
	}
	started, err := s.GetMeetup(ctx, student, later.ID)
	if err != nil || started.Destination == nil || started.Destination.PlaceID != placeID {
		t.Fatalf("after start: %+v %v", started, err)
	}

	// Blocking the host hides their public meetups.
	if err := s.Block(ctx, student, host.Username); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetMeetup(ctx, student, later.ID); !errors.Is(err, social.ErrMeetupNotFound) {
		t.Fatalf("blocked host's meetup still visible: %v", err)
	}
	if err := s.Unblock(ctx, student, host.Username); err != nil {
		t.Fatal(err)
	}

	for name, in := range map[string]social.NewPublicMeetup{
		"short title":  {Title: "ab", Destination: social.DestinationInput{Kind: social.DestinationPlace, PlaceID: placeID}},
		"no place":     {Title: "Study group", Destination: social.DestinationInput{Kind: social.DestinationPlace, PlaceID: "NOPE"}},
		"meets person": {Title: "Study group", Destination: social.DestinationInput{Kind: social.DestinationMember, Username: host.Username}},
		"too far out":  {Title: "Study group", Destination: social.DestinationInput{Kind: social.DestinationPlace, PlaceID: placeID}, StartsIn: 60 * 24 * 30},
	} {
		var bad *social.InvalidError
		if _, err := s.CreatePublicMeetup(ctx, host, in); !errors.As(err, &bad) {
			t.Errorf("%s: expected a validation error, got %v", name, err)
		}
	}

	if _, err := s.EndMeetup(ctx, host, later.ID); err != nil {
		t.Fatal(err)
	}
	// An ended public meetup drops off the campus list entirely, so it reads as gone.
	if _, err := s.JoinPublicMeetup(ctx, student, later.ID); !errors.Is(err, social.ErrMeetupNotFound) && !errors.Is(err, social.ErrMeetupOver) {
		t.Fatalf("join after end: %v", err)
	}
}
