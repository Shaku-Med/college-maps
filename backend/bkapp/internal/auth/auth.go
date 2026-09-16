package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/mail"
	"regexp"
	"strings"
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
	// With 8 digit codes, 5 tries each and 8 codes a day, a guesser has about a 1 in 2.5 million
	// chance per day against one account, no matter how many IPs they use.
	codesPerDay      = 8
	codeCooldown     = 60 * time.Second
	sessionTokenSize = 32
	maxEmailLength   = 254
	maxNameLength    = 40
)

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

// User is the signed in person. Email is private: only the user's own /v1/me response carries it,
// and friends will only ever see Username and DisplayName.
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

type Store interface {
	CodeStats(ctx context.Context, emailIndex []byte, since time.Time) (count int, latest time.Time, err error)
	ReplaceCode(ctx context.Context, emailIndex, hash []byte, expiresAt time.Time) error
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
}

type Option func(*Service)

// WithClock replaces the time source, for tests that need to move time forward.
func WithClock(now func() time.Time) Option {
	return func(s *Service) { s.now = now }
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

	now := s.now()
	count, latest, err := s.store.CodeStats(ctx, index, now.Add(-codeWindow))
	if err != nil {
		return err
	}
	if !latest.IsZero() && now.Sub(latest) < codeCooldown {
		return &RateLimitError{RetryAfter: codeCooldown - now.Sub(latest)}
	}
	if count >= codesPerWindow {
		return &RateLimitError{RetryAfter: codeWindow}
	}
	daily, _, err := s.store.CodeStats(ctx, index, now.Add(-24*time.Hour))
	if err != nil {
		return err
	}
	if daily >= codesPerDay {
		return &RateLimitError{RetryAfter: time.Hour}
	}

	code, err := s.newCode()
	if err != nil {
		return err
	}
	if err := s.store.ReplaceCode(ctx, index, s.keys.codeHash(index, code), now.Add(CodeTTL)); err != nil {
		return err
	}
	if err := s.mailer.SendLoginCode(ctx, addr, code); err != nil {
		return fmt.Errorf("%w: %v", ErrSendFailed, err)
	}
	return nil
}

// VerifyCode signs the user in and returns a new session token for the cookie.
func (s *Service) VerifyCode(ctx context.Context, rawEmail, code string) (User, string, error) {
	addr, err := s.NormalizeEmail(rawEmail)
	if err != nil {
		return User{}, "", err
	}
	code = strings.TrimSpace(code)
	if !codePattern.MatchString(code) {
		return User{}, "", ErrInvalidCode
	}

	now := s.now()
	index := s.keys.EmailIndex(addr)
	expected := s.keys.codeHash(index, code)
	outcome, left, err := s.store.CheckCode(ctx, index, now, MaxCodeAttempts, func(stored []byte) bool {
		return hmac.Equal(stored, expected)
	})
	if err != nil {
		return User{}, "", err
	}
	switch {
	case outcome == CodeLocked, outcome == CodeMismatch && left == 0:
		return User{}, "", ErrCodeLocked
	case outcome == CodeMismatch:
		return User{}, "", &WrongCodeError{AttemptsLeft: left}
	case outcome != CodeAccepted:
		return User{}, "", ErrInvalidCode
	}

	sealed, err := s.keys.sealEmail(addr, index)
	if err != nil {
		return User{}, "", err
	}
	stored, err := s.store.UpsertUser(ctx, index, sealed, now)
	if err != nil {
		return User{}, "", err
	}
	user, err := s.reveal(stored)
	if err != nil {
		return User{}, "", err
	}

	raw := make([]byte, sessionTokenSize)
	if _, err := io.ReadFull(s.random, raw); err != nil {
		return User{}, "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	if err := s.store.CreateSession(ctx, user.ID, s.keys.tokenHash(token), now.Add(SessionTTL)); err != nil {
		return User{}, "", err
	}
	return user, token, nil
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

// revealsEmail blocks names built from the school email, since school addresses follow a
// predictable pattern and a friend could otherwise work out the full address.
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
