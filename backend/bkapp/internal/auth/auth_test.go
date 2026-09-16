package auth_test

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	. "csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/auth/authtest"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

var testSecret = []byte(strings.Repeat("k", 40))

func newTestService(t *testing.T) (*Service, *authtest.MemoryStore, *authtest.CapturedMail, *clock) {
	t.Helper()
	c := &clock{t: time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)}
	store := authtest.NewMemoryStore(c.now)
	mail := &authtest.CapturedMail{}
	svc, err := NewService(store, mail, testSecret, []string{"stu-mail.csi.cuny.edu"}, WithClock(c.now))
	if err != nil {
		t.Fatal(err)
	}
	return svc, store, mail, c
}

func signIn(t *testing.T, svc *Service, mail *authtest.CapturedMail, addr string) (User, string) {
	t.Helper()
	ctx := context.Background()
	if err := svc.RequestCode(ctx, addr); err != nil {
		t.Fatal(err)
	}
	user, token, err := svc.VerifyCode(ctx, addr, mail.Last(addr))
	if err != nil {
		t.Fatal(err)
	}
	return user, token
}

func ptr(s string) *string { return &s }

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

const student = "jane.doe12@stu-mail.csi.cuny.edu"

func TestNormalizeEmail(t *testing.T) {
	svc, _, _, _ := newTestService(t)
	good := map[string]string{
		" Jane.Doe12@STU-MAIL.csi.cuny.edu ": "jane.doe12@stu-mail.csi.cuny.edu",
		"a+b@stu-mail.csi.cuny.edu":          "a+b@stu-mail.csi.cuny.edu",
	}
	for in, want := range good {
		got, err := svc.NormalizeEmail(in)
		if err != nil || got != want {
			t.Errorf("NormalizeEmail(%q) = %q, %v", in, got, err)
		}
	}

	bad := map[string]error{
		"":                                    ErrInvalidEmail,
		"no-at-sign":                          ErrInvalidEmail,
		"Jane <jane@stu-mail.csi.cuny.edu>":   ErrInvalidEmail,
		".jane@stu-mail.csi.cuny.edu":         ErrInvalidEmail,
		"ja..ne@stu-mail.csi.cuny.edu":        ErrInvalidEmail,
		"jane@gmail.com":                      ErrDomainNotAllowed,
		"jane@evil.stu-mail.csi.cuny.edu":     ErrDomainNotAllowed,
		"jane@stu-mail.csi.cuny.edu.evil.com": ErrDomainNotAllowed,
		strings.Repeat("a", 250) + "@stu-mail.csi.cuny.edu": ErrInvalidEmail,
	}
	for in, want := range bad {
		if _, err := svc.NormalizeEmail(in); !errors.Is(err, want) {
			t.Errorf("NormalizeEmail(%q) error = %v, want %v", in, err, want)
		}
	}
}

func TestSignInFlow(t *testing.T) {
	svc, _, mail, _ := newTestService(t)
	ctx := context.Background()

	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatal(err)
	}
	code := mail.Last(student)
	if len(code) != CodeLength {
		t.Fatalf("expected a %d digit code, got %q", CodeLength, code)
	}

	user, token, err := svc.VerifyCode(ctx, strings.ToUpper(student), code)
	if err != nil {
		t.Fatal(err)
	}
	if user.Email != student || !user.NeedsProfile() || token == "" {
		t.Fatalf("unexpected sign in result: %+v %q", user, token)
	}
	if _, _, err := svc.VerifyCode(ctx, student, code); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("a code must only work once")
	}

	authed, err := svc.Authenticate(ctx, token)
	if err != nil || authed.Email != student {
		t.Fatalf("session should authenticate: %v", err)
	}

	named, err := svc.UpdateProfile(ctx, authed, ptr("  Jane   D "), ptr("@JaneOnCampus"))
	if err != nil || named.DisplayName != "Jane D" || named.Username != "janeoncampus" || named.NeedsProfile() {
		t.Fatalf("profile: %+v %v", named, err)
	}

	if err := svc.SignOut(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("signed out token must not authenticate")
	}
}

func TestDatabaseNeverHoldsTheEmail(t *testing.T) {
	svc, store, mail, _ := newTestService(t)
	signIn(t, svc, mail, student)

	rows := store.Users()
	if len(rows) != 1 {
		t.Fatalf("rows: %d", len(rows))
	}
	for _, field := range [][]byte{rows[0].EmailIndex, rows[0].EmailSealed} {
		if bytes.Contains(bytes.ToLower(field), []byte("jane")) || bytes.Contains(field, []byte("stu-mail")) {
			t.Fatal("stored row contains readable email text")
		}
	}

	other, err := NewService(authtest.NewMemoryStore(time.Now), mail, []byte(strings.Repeat("z", 40)), []string{"stu-mail.csi.cuny.edu"})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(svc.EmailIndex(student), other.EmailIndex(student)) {
		t.Fatal("the email index must depend on the server secret")
	}
}

func TestTamperedEmailIsRejected(t *testing.T) {
	svc, store, mail, _ := newTestService(t)
	_, first := signIn(t, svc, mail, student)
	_, second := signIn(t, svc, mail, "other.person@stu-mail.csi.cuny.edu")

	store.TamperUser(0, 1)
	if _, err := svc.Authenticate(context.Background(), second); err == nil {
		t.Fatal("a ciphertext moved to another row must not decrypt")
	}
	if _, err := svc.Authenticate(context.Background(), first); err != nil {
		t.Fatalf("untouched row should still work: %v", err)
	}
}

func TestProfileRules(t *testing.T) {
	svc, _, mail, _ := newTestService(t)
	ctx := context.Background()
	user, _ := signIn(t, svc, mail, student)
	other, _ := signIn(t, svc, mail, "sam.lee@stu-mail.csi.cuny.edu")

	cases := []struct {
		name, username *string
		want           error
	}{
		{nil, nil, ErrNothingToUpdate},
		{ptr(""), nil, ErrInvalidName},
		{ptr(strings.Repeat("x", 41)), nil, ErrInvalidName},
		{ptr("<script>"), nil, ErrInvalidName},
		{ptr("jane@stu-mail"), nil, ErrInvalidName},
		{ptr("Jane.Doe12"), nil, ErrRevealsEmail},
		{nil, ptr("ab"), ErrInvalidUsername},
		{nil, ptr("has space"), ErrInvalidUsername},
		{nil, ptr("_leading"), ErrInvalidUsername},
		{nil, ptr(strings.Repeat("a", 21)), ErrInvalidUsername},
		{nil, ptr("admin"), ErrUsernameUnavailable},
		{nil, ptr("janedoe12"), ErrRevealsEmail},
		{nil, ptr("the_janedoe12"), ErrRevealsEmail},
	}
	for _, tc := range cases {
		if _, err := svc.UpdateProfile(ctx, user, tc.name, tc.username); !errors.Is(err, tc.want) {
			t.Errorf("name %s username %s: got %v, want %v", deref(tc.name), deref(tc.username), err, tc.want)
		}
	}

	if _, err := svc.UpdateProfile(ctx, other, nil, ptr("sam_on_campus")); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateProfile(ctx, user, nil, ptr("SAM_ON_CAMPUS")); !errors.Is(err, ErrUsernameUnavailable) {
		t.Fatalf("taken username: %v", err)
	}
}

func TestSignOutEverywhere(t *testing.T) {
	svc, _, mail, c := newTestService(t)
	ctx := context.Background()
	user, laptop := signIn(t, svc, mail, student)
	c.advance(2 * time.Minute)
	_, phone := signIn(t, svc, mail, student)

	if err := svc.SignOutEverywhere(ctx, user); err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{laptop, phone} {
		if _, err := svc.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
			t.Fatal("every session must end")
		}
	}
}

func TestDeleteAccount(t *testing.T) {
	svc, store, mail, c := newTestService(t)
	ctx := context.Background()
	user, token := signIn(t, svc, mail, student)
	c.advance(2 * time.Minute)
	other, otherToken := signIn(t, svc, mail, "sam.lee@stu-mail.csi.cuny.edu")
	c.advance(2 * time.Minute)
	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatal(err)
	}

	if err := svc.DeleteAccount(ctx, user); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("deleted account session must not work")
	}
	if _, err := svc.Authenticate(ctx, otherToken); err != nil {
		t.Fatal("other accounts must stay")
	}
	rows := store.Users()
	if len(rows) != 1 || rows[0].ID != other.ID {
		t.Fatalf("users after delete: %+v", rows)
	}
	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatalf("wiped email should be able to request a new code: %v", err)
	}
}

func TestAccountRecord(t *testing.T) {
	svc, _, mail, _ := newTestService(t)
	ctx := context.Background()
	user, _ := signIn(t, svc, mail, student)
	rec, err := svc.AccountRecord(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if len(rec.Sessions) != 1 {
		t.Fatalf("sessions: %d", len(rec.Sessions))
	}
}

func TestIdleSessionsExpire(t *testing.T) {
	svc, _, mail, c := newTestService(t)
	ctx := context.Background()
	_, token := signIn(t, svc, mail, student)

	c.advance(SessionIdleTTL - time.Hour)
	if _, err := svc.Authenticate(ctx, token); err != nil {
		t.Fatalf("recently used session should work: %v", err)
	}
	c.advance(SessionIdleTTL + time.Hour)
	if _, err := svc.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("a session unused for the idle window must expire")
	}
}

func TestCodeRateLimits(t *testing.T) {
	svc, _, _, c := newTestService(t)
	ctx := context.Background()

	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatal(err)
	}
	var limited *RateLimitError
	if err := svc.RequestCode(ctx, student); !errors.As(err, &limited) {
		t.Fatalf("second request within cooldown should be limited, got %v", err)
	}

	c.advance(61 * time.Second)
	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatal(err)
	}
	c.advance(61 * time.Second)
	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatal(err)
	}
	c.advance(61 * time.Second)
	if err := svc.RequestCode(ctx, student); !errors.As(err, &limited) {
		t.Fatalf("fourth code in the window should be limited, got %v", err)
	}
}

func TestDailyCodeCap(t *testing.T) {
	svc, _, _, c := newTestService(t)
	ctx := context.Background()
	var limited *RateLimitError
	sent := 0
	for i := 0; i < 20; i++ {
		c.advance(16 * time.Minute)
		if err := svc.RequestCode(ctx, student); err == nil {
			sent++
		} else if !errors.As(err, &limited) {
			t.Fatal(err)
		}
	}
	if sent != 8 {
		t.Fatalf("sent %d codes in a day, want 8", sent)
	}
}

func TestNewestCodeReplacesOlder(t *testing.T) {
	svc, _, mail, c := newTestService(t)
	ctx := context.Background()

	_ = svc.RequestCode(ctx, student)
	first := mail.Last(student)
	c.advance(61 * time.Second)
	_ = svc.RequestCode(ctx, student)
	second := mail.Last(student)

	if first != second {
		if _, _, err := svc.VerifyCode(ctx, student, first); !errors.Is(err, ErrInvalidCode) {
			t.Fatal("an older code must stop working once a new one is sent")
		}
	}
	if _, _, err := svc.VerifyCode(ctx, student, second); err != nil {
		t.Fatalf("newest code should work: %v", err)
	}
}

func TestCodeExpiresAndLocksAfterAttempts(t *testing.T) {
	svc, _, mail, c := newTestService(t)
	ctx := context.Background()

	_ = svc.RequestCode(ctx, student)
	code := mail.Last(student)
	c.advance(CodeTTL + time.Second)
	if _, _, err := svc.VerifyCode(ctx, student, code); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("expired code must fail")
	}

	c.advance(time.Hour)
	_ = svc.RequestCode(ctx, student)
	code = mail.Last(student)
	wrong := "00000000"
	if code == wrong {
		wrong = "11111111"
	}
	for i := 0; i < MaxCodeAttempts; i++ {
		_, _, err := svc.VerifyCode(ctx, student, wrong)
		if !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("wrong code attempt %d should fail", i)
		}
		var tries *WrongCodeError
		if i < MaxCodeAttempts-1 && (!errors.As(err, &tries) || tries.AttemptsLeft != MaxCodeAttempts-1-i) {
			t.Fatalf("attempt %d should report %d tries left, got %v", i, MaxCodeAttempts-1-i, err)
		}
		if i == MaxCodeAttempts-1 && !errors.Is(err, ErrCodeLocked) {
			t.Fatalf("the last wrong try should lock the code, got %v", err)
		}
	}
	if _, _, err := svc.VerifyCode(ctx, student, code); !errors.Is(err, ErrInvalidCode) {
		t.Fatal("code must lock after too many wrong attempts, even if the right code comes next")
	}
}

func TestRejectsMalformedInput(t *testing.T) {
	svc, _, _, _ := newTestService(t)
	ctx := context.Background()

	for _, code := range []string{"", "1234567", "123456789", "abcdefgh", "1234 678"} {
		if _, _, err := svc.VerifyCode(ctx, student, code); !errors.Is(err, ErrInvalidCode) {
			t.Errorf("code %q should be rejected", code)
		}
	}
	for _, token := range []string{"", "short", strings.Repeat("A", 43) + "!"} {
		if _, err := svc.Authenticate(ctx, token); !errors.Is(err, ErrUnauthorized) {
			t.Errorf("token %q should be rejected", token)
		}
	}
}

func TestWeakSecretRejected(t *testing.T) {
	if _, err := NewService(authtest.NewMemoryStore(time.Now), &authtest.CapturedMail{}, []byte("short"), nil); err == nil {
		t.Fatal("a short secret must be rejected")
	}
}

func TestSendFailureIsReported(t *testing.T) {
	svc, _, mail, _ := newTestService(t)
	mail.Fail = true
	if err := svc.RequestCode(context.Background(), student); !errors.Is(err, ErrSendFailed) {
		t.Fatalf("expected ErrSendFailed, got %v", err)
	}
}

// A mail outage on our side must not cost the person a try or hold the cooldown open.
func TestSendFailureDoesNotSpendATry(t *testing.T) {
	svc, store, mail, c := newTestService(t)
	ctx := context.Background()

	mail.Fail = true
	// Well past both the per window and the daily limit, with no wait in between.
	for i := 0; i < 12; i++ {
		err := svc.RequestCode(ctx, student)
		if !errors.Is(err, ErrSendFailed) {
			t.Fatalf("attempt %d should still be an email failure, got %v", i, err)
		}
		var limited *RateLimitError
		if errors.As(err, &limited) {
			t.Fatalf("attempt %d was rate limited by our own failures", i)
		}
	}

	count, latest, err := store.CodeStats(ctx, svc.EmailIndex(student), c.now().Add(-24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 || !latest.IsZero() {
		t.Fatalf("failed sends left %d unusable codes behind (latest %v)", count, latest)
	}

	mail.Fail = false
	if err := svc.RequestCode(ctx, student); err != nil {
		t.Fatalf("the next request should go through once email works: %v", err)
	}
	if mail.Last(student) == "" {
		t.Fatal("no code was sent")
	}
}
