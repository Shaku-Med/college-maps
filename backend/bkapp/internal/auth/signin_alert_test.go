package auth_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	. "csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/auth/authtest"
	"csimap/bkapp/internal/email"
)

func requestAndSignIn(t *testing.T, svc *Service, mail *authtest.CapturedMail, seen email.SignIn) {
	t.Helper()
	ctx := context.Background()
	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatal(err)
	}
	svc.Wait()
	if _, _, err := svc.SignIn(ctx, student, mail.Last(student), seen); err != nil {
		t.Fatal(err)
	}
	svc.Wait()
}

func TestSignInAlertSkipsTheNewAccount(t *testing.T) {
	svc, _, mail, c := newTestService(t)
	seen := email.SignIn{Device: "Chrome on Windows", IP: "203.0.113.9", Location: "Staten Island, New York, US"}

	requestAndSignIn(t, svc, mail, seen)
	if got := mail.Alerts(student); len(got) != 0 {
		t.Fatalf("making the account sent %d alerts, want none", len(got))
	}

	c.advance(2 * time.Minute)
	requestAndSignIn(t, svc, mail, seen)
	got := mail.Alerts(student)
	if len(got) != 1 {
		t.Fatalf("a returning sign in sent %d alerts, want 1", len(got))
	}
	if got[0].Device != seen.Device || got[0].IP != seen.IP || got[0].Location != seen.Location || !got[0].When.Equal(c.now()) {
		t.Fatalf("alert = %+v, want the request's details at %v", got[0], c.now())
	}
}

func TestWrongCodeSendsNoAlert(t *testing.T) {
	svc, _, mail, c := newTestService(t)
	signIn(t, svc, mail, student)
	c.advance(2 * time.Minute)
	if err := svc.RequestCode(context.Background(), student); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.SignIn(context.Background(), student, "00000000", email.SignIn{IP: "203.0.113.9"}); err == nil {
		t.Fatal("a wrong code signed in")
	}
	if got := mail.Alerts(student); len(got) != 0 {
		t.Fatalf("a failed sign in sent %d alerts", len(got))
	}
}

func newBackgroundService(t *testing.T) (*Service, *authtest.MemoryStore, *authtest.CapturedMail, *clock) {
	t.Helper()
	c := &clock{t: time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)}
	store := authtest.NewMemoryStore(c.now)
	mail := &authtest.CapturedMail{}
	svc, err := NewService(store, mail, testSecret, []string{"stu-mail.csi.cuny.edu"}, WithClock(c.now),
		WithBackgroundMail(slog.New(slog.NewTextHandler(io.Discard, nil))))
	if err != nil {
		t.Fatal(err)
	}
	return svc, store, mail, c
}

func TestBackgroundMailDelivers(t *testing.T) {
	svc, _, mail, _ := newBackgroundService(t)
	if err := svc.RequestCode(context.Background(), student); err != nil {
		t.Fatal(err)
	}
	svc.Wait()
	if mail.Last(student) == "" {
		t.Fatal("no code was sent")
	}
}

// A failed send in the background answers like a sent one, but must still free the cooldown and the try.
func TestBackgroundSendFailureClearsTheCode(t *testing.T) {
	svc, store, mail, c := newBackgroundService(t)
	ctx := context.Background()
	mail.Fail = true
	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatalf("a background failure should not reach the caller: %v", err)
	}
	svc.Wait()
	count, _, err := store.CodeStats(ctx, svc.EmailIndex(student), c.now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("a failed send left %d codes behind", count)
	}
	mail.Fail = false
	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatalf("the next request should go straight through: %v", err)
	}
}

func TestBackgroundMailNeedsALogger(t *testing.T) {
	if _, err := NewService(authtest.NewMemoryStore(time.Now), &authtest.CapturedMail{}, testSecret,
		[]string{"stu-mail.csi.cuny.edu"}, WithBackgroundMail(nil)); err == nil {
		t.Fatal("background mail without a logger must be refused")
	}
}
