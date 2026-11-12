package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/mail"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"csimap/bkapp/internal/email"
)

const (
	CodeLength     = 8
	CodeTTL        = 10 * time.Minute
	SessionTTL     = 30 * 24 * time.Hour
	SessionIdleTTL = 14 * 24 * time.Hour
	// Accounts that never set a name and username are removed after this long.
	IncompleteAccountTTL = 48 * time.Hour
	MaxCodeAttempts      = 5
	codesPerWindow       = 3
	codeWindow           = 15 * time.Minute
	// 8 digits, 5 tries each, 8 codes a day: about 1 in 2.5 million a day per account, whatever the IPs.
	codesPerDay      = 8
	codeCooldown     = 60 * time.Second
	sessionTokenSize = 32
	maxEmailLength   = 254
	maxNameLength    = 40
)

const (
	// Background emails share a few connections, and a stuck mail server gives up rather than piling up.
	maxParallelMail = 8
	mailTimeout     = 45 * time.Second
	cleanupTimeout  = 10 * time.Second
)

// The mail provider sends 1000 a day. Codes may use nearly all of it; alerts stop early so codes always have room.
const (
	dailyMailLimit    = 950
	dailyOptionalMail = 600
)

var errMailBudget = errors.New("daily email limit reached")

var (
	ErrInvalidEmail        = errors.New("invalid email")
	ErrDomainNotAllowed    = errors.New("email domain not allowed")
	ErrInvalidCode         = errors.New("invalid or expired code")
	ErrInvalidName         = errors.New("invalid display name")
	ErrInvalidUsername     = errors.New("invalid username")
	ErrUsernameUnavailable = errors.New("username unavailable")
	ErrRevealsEmail        = errors.New("profile would reveal the email address")
	ErrNothingToUpdate     = errors.New("nothing to update")
	ErrUnauthorized        = errors.New("not signed in")
	ErrSendFailed          = errors.New("could not send code")
	ErrCodeLocked          = fmt.Errorf("%w: too many wrong tries", ErrInvalidCode)
)

// WrongCodeError is a wrong guess on a code that still has tries left.
type WrongCodeError struct {
	AttemptsLeft int
}

func (e *WrongCodeError) Error() string {
	return fmt.Sprintf("wrong code, %d tries left", e.AttemptsLeft)
}

func (e *WrongCodeError) Is(target error) bool {
	return target == ErrInvalidCode
}

type RateLimitError struct {
	RetryAfter time.Duration
}

func (e *RateLimitError) Error() string {
	return fmt.Sprintf("too many code requests, retry after %s", e.RetryAfter.Round(time.Second))
}

var (
	codePattern     = regexp.MustCompile(`^[0-9]{8}$`)
	localPattern    = regexp.MustCompile(`^[A-Za-z0-9._%+-]{1,64}$`)
	namePattern     = regexp.MustCompile(`^[\p{L}\p{M}\p{N} .'-]+$`)
	usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_]{2,19}$`)
	collapseSpace   = regexp.MustCompile(`\s+`)
)

var reservedUsernames = map[string]bool{
	"admin": true, "administrator": true, "root": true, "system": true, "support": true, "help": true,
	"security": true, "official": true, "staff": true, "moderator": true, "mod": true, "csi": true,
	"csimap": true, "cuny": true, "null": true, "undefined": true, "me": true, "you": true, "api": true,
	"www": true, "mail": true, "noreply": true, "no_reply": true, "everyone": true, "anonymous": true,
}

// User is the signed in person. Email is private: only the owner's own /v1/me response carries it.
type User struct {
	ID          string
	Email       string
	Username    string
	DisplayName string
}

func (u User) NeedsProfile() bool {
	return u.DisplayName == "" || u.Username == ""
}

// StoredUser is a row as the database holds it: the email only as a blind index and ciphertext.
type StoredUser struct {
	ID          string
	EmailIndex  []byte
	EmailSealed []byte
	Username    string
	DisplayName string
	// Created is set by UpsertUser when this sign in made the account.
	Created bool
}

type ProfileUpdate struct {
	DisplayName *string
	Username    *string
}

type SessionRecord struct {
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
}

type AccountRecord struct {
	CreatedAt   time.Time
	LastLoginAt *time.Time
	Sessions    []SessionRecord
}

type VerifyOutcome int

const (
	CodeMissing VerifyOutcome = iota
	CodeMismatch
	CodeLocked
	CodeAccepted
)

// CodeLimits caps how often one email can be sent a code.
type CodeLimits struct {
	Cooldown  time.Duration
	Window    time.Duration
	PerWindow int
	PerDay    int
}

type Store interface {
	CodeStats(ctx context.Context, emailIndex []byte, since time.Time) (count int, latest time.Time, err error)
	// IssueCode checks the limits and stores a code in one locked step; a positive wait means refused.
	IssueCode(ctx context.Context, emailIndex, hash []byte, now, expiresAt time.Time, limits CodeLimits) (wait time.Duration, err error)
	DeleteCodes(ctx context.Context, emailIndex []byte) error
	CheckCode(ctx context.Context, emailIndex []byte, now time.Time, maxAttempts int, matches func(hash []byte) bool) (outcome VerifyOutcome, attemptsLeft int, err error)
	UpsertUser(ctx context.Context, emailIndex, emailSealed []byte, now time.Time) (StoredUser, error)
	CreateSession(ctx context.Context, userID string, tokenHash []byte, expiresAt time.Time) error
	SessionUser(ctx context.Context, tokenHash []byte, now, idleSince time.Time) (StoredUser, error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
	DeleteUserSessions(ctx context.Context, userID string) error
	UpdateProfile(ctx context.Context, userID string, update ProfileUpdate) (StoredUser, error)
	DeleteAccount(ctx context.Context, userID string, emailIndex []byte) error
	AccountRecord(ctx context.Context, userID string) (AccountRecord, error)
	DeleteExpired(ctx context.Context, now, idleSince time.Time) error
}

type Service struct {
	store   Store
	mailer  email.Sender
	keys    *Keys
	domains map[string]struct{}
	now     func() time.Time
	random  io.Reader

	reviewEmail string
	reviewCode  string
	reviewUntil time.Time

	background bool
	logger     *slog.Logger
	mailSlots  chan struct{}
	pending    sync.WaitGroup
	budget     mailBudget
}

// mailBudget counts emails per UTC day, the day the provider's quota resets on.
type mailBudget struct {
	mu   sync.Mutex
	day  string
	sent int
}

func (b *mailBudget) take(limit int, now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if day := now.UTC().Format(time.DateOnly); day != b.day {
		b.day, b.sent = day, 0
	}
	if b.sent >= limit {
		return false
	}
	b.sent++
	return true
}

type Option func(*Service)

// WithClock replaces the time source, for tests that need to move time forward.
func WithClock(now func() time.Time) Option {
	return func(s *Service) { s.now = now }
}

// WithBackgroundMail sends emails after the request returns, so nobody waits on the mail server. A code that fails to
// send is removed, so it holds no cooldown, and the failure is logged.
func WithBackgroundMail(logger *slog.Logger) Option {
	return func(s *Service) {
		s.background = true
		s.logger = logger
	}
}

// WithReviewAccount gives one school address a fixed code for App Store review, under every normal limit, until a date.
func WithReviewAccount(address, code string, until time.Time) Option {
	return func(s *Service) {
		s.reviewEmail = strings.ToLower(strings.TrimSpace(address))
		s.reviewCode = code
		s.reviewUntil = until
	}
}

func NewService(store Store, mailer email.Sender, secret []byte, domains []string, opts ...Option) (*Service, error) {
	keys, err := DeriveKeys(secret)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]struct{}, len(domains))
	for _, d := range domains {
		allowed[strings.ToLower(d)] = struct{}{}
	}
	s := &Service{store: store, mailer: mailer, keys: keys, domains: allowed, now: time.Now, random: rand.Reader}
	for _, opt := range opts {
		opt(s)
	}
	if s.background && s.logger == nil {
		return nil, errors.New("background mail needs a logger")
	}
	s.mailSlots = make(chan struct{}, maxParallelMail)
	if s.reviewEmail != "" || s.reviewCode != "" {
		addr, err := s.NormalizeEmail(s.reviewEmail)
		if err != nil || addr != s.reviewEmail || !codePattern.MatchString(s.reviewCode) || s.reviewUntil.IsZero() {
			return nil, errors.New("the review account needs an allowed school email, an 8 digit code, and an end date")
		}
	}
	return s, nil
}

func (s *Service) AllowedDomains() []string {
	list := make([]string, 0, len(s.domains))
	for d := range s.domains {
		list = append(list, d)
	}
	return list
}

func (s *Service) NormalizeEmail(raw string) (string, error) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" || len(trimmed) > maxEmailLength {
		return "", ErrInvalidEmail
	}
	parsed, err := mail.ParseAddress(trimmed)
	if err != nil || parsed.Name != "" || parsed.Address != trimmed {
		return "", ErrInvalidEmail
	}
	local, domain, ok := strings.Cut(trimmed, "@")
	if !ok || !localPattern.MatchString(local) || strings.HasPrefix(local, ".") || strings.HasSuffix(local, ".") || strings.Contains(local, "..") {
		return "", ErrInvalidEmail
	}
	if _, allowed := s.domains[domain]; !allowed {
		return "", ErrDomainNotAllowed
	}
	return trimmed, nil
}

func (s *Service) newCode() (string, error) {
	n, err := rand.Int(s.random, big.NewInt(100_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%08d", n.Int64()), nil
}

func (s *Service) RequestCode(ctx context.Context, rawEmail string) error {
	addr, err := s.NormalizeEmail(rawEmail)
	if err != nil {
		return err
	}
	index := s.keys.EmailIndex(addr)

	code, err := s.newCode()
	if err != nil {
		return err
	}
	now := s.now()
	review := s.reviewEmail != "" && addr == s.reviewEmail && now.Before(s.reviewUntil)
	if review {
		code = s.reviewCode
	}
	wait, err := s.store.IssueCode(ctx, index, s.keys.codeHash(index, code), now, now.Add(CodeTTL), CodeLimits{
		Cooldown:  codeCooldown,
		Window:    codeWindow,
		PerWindow: codesPerWindow,
		PerDay:    codesPerDay,
	})
	if err != nil {
		return err
	}
	if wait > 0 {
		return &RateLimitError{RetryAfter: wait}
	}
	// The reviewer has the code from the review notes, so there is nothing to send.
	if review {
		return nil
	}
	return s.mail(ctx, mailCode,
		func(ctx context.Context) error { return s.mailer.SendLoginCode(ctx, addr, code) },
		// Nobody received this code, so it should not spend one of the sender's tries or hold the cooldown open.
		func(ctx context.Context) { _ = s.store.DeleteCodes(ctx, index) },
	)
}

const mailCode = "sign-in code"

// mail sends now, or after the response with background mail on. Either way failed runs when the send fails.
func (s *Service) mail(ctx context.Context, kind string, send func(context.Context) error, failed func(context.Context)) error {
	cleanUp := func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
		defer cancel()
		failed(ctx)
	}
	limit := dailyOptionalMail
	if kind == mailCode {
		limit = dailyMailLimit
	}
	if !s.budget.take(limit, s.now()) {
		cleanUp()
		if s.logger != nil {
			s.logger.Warn("email not sent", "kind", kind, "error", errMailBudget)
		}
		return fmt.Errorf("%w: %v", ErrSendFailed, errMailBudget)
	}
	if !s.background {
		if err := send(ctx); err != nil {
			cleanUp()
			return fmt.Errorf("%w: %v", ErrSendFailed, err)
		}
		return nil
	}
	s.pending.Add(1)
	go func() {
		defer s.pending.Done()
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), mailTimeout)
		defer cancel()
		select {
		case s.mailSlots <- struct{}{}:
			defer func() { <-s.mailSlots }()
		case <-ctx.Done():
			cleanUp()
			s.logger.Warn("email not sent: too many waiting", "kind", kind)
			return
		}
		if err := send(ctx); err != nil {
			cleanUp()
			s.logger.Warn("email not sent", "kind", kind, "error", err)
		}
	}()
	return nil
}

// Notify sends an email that is not about a sign in the same way as the others, in the background when that is on.
func (s *Service) Notify(ctx context.Context, kind string, send func(context.Context) error) error {
	return s.mail(ctx, kind, send, func(context.Context) {})
}

// Wait blocks until background emails finish, so a shutdown does not drop them.
func (s *Service) Wait() {
	s.pending.Wait()
}

// VerifyCode signs the user in and returns a new session token for the cookie.
func (s *Service) VerifyCode(ctx context.Context, rawEmail, code string) (User, string, error) {
	user, token, _, err := s.verifyCode(ctx, rawEmail, code)
	return user, token, err
}

// SignIn is VerifyCode that also emails the owner where the sign in came from, unless it just made the account.
// The alert never blocks or fails the sign in.
func (s *Service) SignIn(ctx context.Context, rawEmail, code string, seen email.SignIn) (User, string, error) {
	user, token, created, err := s.verifyCode(ctx, rawEmail, code)
	if err != nil || created || (s.reviewEmail != "" && user.Email == s.reviewEmail) {
		return user, token, err
	}
	seen.When = s.now()
	to := user.Email
	_ = s.mail(ctx, "sign-in alert",
		func(ctx context.Context) error { return s.mailer.SendSignInAlert(ctx, to, seen) },
		func(context.Context) {},
	)
	return user, token, nil
}

func (s *Service) verifyCode(ctx context.Context, rawEmail, code string) (User, string, bool, error) {
	addr, err := s.NormalizeEmail(rawEmail)
	if err != nil {
		return User{}, "", false, err
	}
	code = strings.TrimSpace(code)
	if !codePattern.MatchString(code) {
		return User{}, "", false, ErrInvalidCode
	}

	now := s.now()
	index := s.keys.EmailIndex(addr)
	expected := s.keys.codeHash(index, code)
	outcome, left, err := s.store.CheckCode(ctx, index, now, MaxCodeAttempts, func(stored []byte) bool {
		return hmac.Equal(stored, expected)
	})
	if err != nil {
		return User{}, "", false, err
	}
	switch {
	case outcome == CodeLocked, outcome == CodeMismatch && left == 0:
		return User{}, "", false, ErrCodeLocked
	case outcome == CodeMismatch:
		return User{}, "", false, &WrongCodeError{AttemptsLeft: left}
	case outcome != CodeAccepted:
		return User{}, "", false, ErrInvalidCode
	}

	sealed, err := s.keys.sealEmail(addr, index)
	if err != nil {
		return User{}, "", false, err
	}
	stored, err := s.store.UpsertUser(ctx, index, sealed, now)
	if err != nil {
		return User{}, "", false, err
	}
	user, err := s.reveal(stored)
	if err != nil {
		return User{}, "", false, err
	}

	raw := make([]byte, sessionTokenSize)
	if _, err := io.ReadFull(s.random, raw); err != nil {
		return User{}, "", false, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	if err := s.store.CreateSession(ctx, user.ID, s.keys.tokenHash(token), now.Add(SessionTTL)); err != nil {
		return User{}, "", false, err
	}
	return user, token, stored.Created, nil
}

func (s *Service) reveal(stored StoredUser) (User, error) {
	addr, err := s.keys.openEmail(stored.EmailSealed, stored.EmailIndex)
	if err != nil {
		return User{}, err
	}
	return User{ID: stored.ID, Email: addr, Username: stored.Username, DisplayName: stored.DisplayName}, nil
}

func validToken(token string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(decoded) == sessionTokenSize
}

func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	if !validToken(token) {
		return User{}, ErrUnauthorized
	}
	now := s.now()
	stored, err := s.store.SessionUser(ctx, s.keys.tokenHash(token), now, now.Add(-SessionIdleTTL))
	if err != nil {
		return User{}, err
	}
	return s.reveal(stored)
}

func (s *Service) SignOut(ctx context.Context, token string) error {
	if !validToken(token) {
		return nil
	}
	return s.store.DeleteSession(ctx, s.keys.tokenHash(token))
}

// SignOutEverywhere ends every session for the user, for a lost phone or a shared computer.
func (s *Service) SignOutEverywhere(ctx context.Context, user User) error {
	return s.store.DeleteUserSessions(ctx, user.ID)
}

// DeleteAccount wipes the signed-in student: profile, friends, meetups, sessions, and leftover codes.
func (s *Service) DeleteAccount(ctx context.Context, user User) error {
	if user.ID == "" || user.Email == "" {
		return ErrUnauthorized
	}
	return s.store.DeleteAccount(ctx, user.ID, s.keys.EmailIndex(user.Email))
}

func (s *Service) AccountRecord(ctx context.Context, user User) (AccountRecord, error) {
	if user.ID == "" {
		return AccountRecord{}, ErrUnauthorized
	}
	return s.store.AccountRecord(ctx, user.ID)
}

// alphanumeric keeps only letters and digits, lowercased, so "Jane.Doe_12" and "janedoe12" compare equal.
func alphanumeric(value string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// revealsEmail blocks names built from the school email, which would give the full address away.
func revealsEmail(value, addr string) bool {
	local, _, _ := strings.Cut(addr, "@")
	key := alphanumeric(local)
	candidate := alphanumeric(value)
	if key == "" || candidate == "" {
		return false
	}
	return candidate == key || (len(key) >= 5 && strings.Contains(candidate, key))
}

func (s *Service) UpdateProfile(ctx context.Context, user User, displayName, username *string) (User, error) {
	var update ProfileUpdate
	if displayName != nil {
		name := collapseSpace.ReplaceAllString(strings.TrimSpace(*displayName), " ")
		if name == "" || utf8.RuneCountInString(name) > maxNameLength || !namePattern.MatchString(name) {
			return User{}, ErrInvalidName
		}
		if revealsEmail(name, user.Email) {
			return User{}, ErrRevealsEmail
		}
		update.DisplayName = &name
	}
	if username != nil {
		handle := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(*username), "@"))
		if !usernamePattern.MatchString(handle) {
			return User{}, ErrInvalidUsername
		}
		if reservedUsernames[handle] {
			return User{}, ErrUsernameUnavailable
		}
		if revealsEmail(handle, user.Email) {
			return User{}, ErrRevealsEmail
		}
		update.Username = &handle
	}
	if update.DisplayName == nil && update.Username == nil {
		return User{}, ErrNothingToUpdate
	}

	stored, err := s.store.UpdateProfile(ctx, user.ID, update)
	if err != nil {
		return User{}, err
	}
	return s.reveal(stored)
}

func (s *Service) Cleanup(ctx context.Context) error {
	now := s.now()
	return s.store.DeleteExpired(ctx, now, now.Add(-SessionIdleTTL))
}

// EmailIndex exposes the blind index so tools and tests can find a row without the plain email.
func (s *Service) EmailIndex(addr string) []byte {
	return s.keys.EmailIndex(addr)
}
