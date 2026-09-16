// Package social handles friends, blocks, and private meetups. People are always addressed by
// username; database ids never leave this package.
package social

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"csimap/bkapp/internal/campus"
)

var (
	ErrProfileIncomplete = errors.New("finish your profile first")
	ErrUserNotFound      = errors.New("no one with that username")
	ErrSelf              = errors.New("that is you")
	ErrAlreadyFriends    = errors.New("already friends")
	ErrYouBlocked        = errors.New("you blocked this person")
	ErrNoRequest         = errors.New("no friend request")
	ErrNotFriends        = errors.New("not friends")
	ErrTooMany           = errors.New("too many at once")
	ErrMeetupNotFound    = errors.New("meetup not found")
	ErrMeetupOver        = errors.New("meetup is over")
	ErrNotHost           = errors.New("only the host can do that")
	ErrNotJoined         = errors.New("join the meetup first")
)

// InvalidError explains which part of a request was rejected, in words safe to show the user.
type InvalidError struct{ Reason string }

func (e *InvalidError) Error() string { return e.Reason }

func invalid(format string, args ...any) error {
	return &InvalidError{Reason: fmt.Sprintf(format, args...)}
}

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_]{2,19}$`)

type Service struct {
	pool         *pgxpool.Pool
	site         *campus.Campus
	ticketSecret []byte
	now          func() time.Time
	random       io.Reader
	notify       func(senderID string, userIDs []string, title, body, path string)
}

func NewService(pool *pgxpool.Pool, site *campus.Campus, ticketSecret []byte) (*Service, error) {
	if len(ticketSecret) < 32 {
		return nil, errors.New("ticket secret must be at least 32 bytes")
	}
	return &Service{pool: pool, site: site, ticketSecret: ticketSecret, now: time.Now, random: rand.Reader}, nil
}

func (s *Service) SetNotify(fn func(senderID string, userIDs []string, title, body, path string)) {
	s.notify = fn
}

func (s *Service) ping(senderID string, userIDs []string, title, body, path string) {
	if s.notify == nil || senderID == "" || len(userIDs) == 0 {
		return
	}
	s.notify(senderID, userIDs, title, body, path)
}

// Person is how another student appears: a handle and a name, nothing else.
type Person struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

func normalizeUsername(raw string) (string, bool) {
	handle := strings.ToLower(strings.TrimPrefix(strings.TrimSpace(raw), "@"))
	return handle, usernamePattern.MatchString(handle)
}

// publicID is what URLs and the realtime server see instead of a database id.
func (s *Service) publicID() (string, error) {
	raw := make([]byte, 12)
	if _, err := io.ReadFull(s.random, raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// liveID gives each member a different opaque id in every meetup, so realtime traffic cannot be
// linked to an account or followed from one meetup to the next.
func (s *Service) liveID(meetupPublicID, userID string) string {
	mac := hmac.New(sha256.New, s.ticketSecret)
	mac.Write([]byte("csimap-live-member:v1:" + meetupPublicID + ":" + userID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:16])
}
