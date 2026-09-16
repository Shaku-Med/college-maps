// Package authtest provides an in-memory auth store and mailer for tests.
package authtest

import (
	"bytes"
	"context"
	"fmt"
	"sync"
	"time"

	"csimap/bkapp/internal/auth"
)

type memCode struct {
	index     []byte
	hash      []byte
	attempts  int
	expiresAt time.Time
	consumed  bool
	createdAt time.Time
}

type memSession struct {
	userID    string
	hash      []byte
	expiresAt time.Time
	lastSeen  time.Time
}

// MemoryStore mirrors PostgresStore's rules so the service can be tested without a database.
type MemoryStore struct {
	mu       sync.Mutex
	now      func() time.Time
	codes    []*memCode
	users    []*auth.StoredUser
	sessions []*memSession
	nextID   int
}

func NewMemoryStore(now func() time.Time) *MemoryStore {
	return &MemoryStore{now: now}
}

// Users returns copies of the stored rows so tests can check what a database would hold.
func (m *MemoryStore) Users() []auth.StoredUser {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]auth.StoredUser, len(m.users))
	for i, u := range m.users {
		out[i] = *u
	}
	return out
}

// TamperUser swaps one row's sealed email for another's, like an attacker with database write access.
func (m *MemoryStore) TamperUser(from, to int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.users[to].EmailSealed = m.users[from].EmailSealed
}

func (m *MemoryStore) CodeStats(_ context.Context, index []byte, since time.Time) (int, time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	count, latest := 0, time.Time{}
	for _, c := range m.codes {
		if bytes.Equal(c.index, index) && !c.createdAt.Before(since) {
			count++
			if c.createdAt.After(latest) {
				latest = c.createdAt
			}
		}
	}
	return count, latest, nil
}

func (m *MemoryStore) ReplaceCode(_ context.Context, index, hash []byte, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, c := range m.codes {
		if bytes.Equal(c.index, index) {
			c.consumed = true
		}
	}
	m.codes = append(m.codes, &memCode{index: index, hash: hash, expiresAt: expiresAt, createdAt: m.now()})
	return nil
}

func (m *MemoryStore) CheckCode(_ context.Context, index []byte, now time.Time, maxAttempts int, matches func([]byte) bool) (auth.VerifyOutcome, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var latest *memCode
	for _, c := range m.codes {
		if bytes.Equal(c.index, index) && !c.consumed && c.expiresAt.After(now) && (latest == nil || c.createdAt.After(latest.createdAt)) {
			latest = c
		}
	}
	switch {
	case latest == nil:
		return auth.CodeMissing, 0, nil
	case latest.attempts >= maxAttempts:
		latest.consumed = true
		return auth.CodeLocked, 0, nil
	case !matches(latest.hash):
		latest.attempts++
		if latest.attempts >= maxAttempts {
			latest.consumed = true
		}
		return auth.CodeMismatch, maxAttempts - latest.attempts, nil
	default:
		kept := m.codes[:0]
		for _, c := range m.codes {
			if !bytes.Equal(c.index, index) {
				kept = append(kept, c)
			}
		}
		m.codes = kept
		return auth.CodeAccepted, 0, nil
	}
}

func (m *MemoryStore) UpsertUser(_ context.Context, index, sealed []byte, _ time.Time) (auth.StoredUser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if bytes.Equal(u.EmailIndex, index) {
			return *u, nil
		}
	}
	m.nextID++
	u := &auth.StoredUser{ID: fmt.Sprintf("user-%d", m.nextID), EmailIndex: index, EmailSealed: sealed}
	m.users = append(m.users, u)
	return *u, nil
}

func (m *MemoryStore) CreateSession(_ context.Context, userID string, tokenHash []byte, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions = append(m.sessions, &memSession{userID: userID, hash: tokenHash, expiresAt: expiresAt, lastSeen: m.now()})
	return nil
}

func (m *MemoryStore) SessionUser(_ context.Context, tokenHash []byte, now, idleSince time.Time) (auth.StoredUser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		if bytes.Equal(s.hash, tokenHash) && s.expiresAt.After(now) && s.lastSeen.After(idleSince) {
			for _, u := range m.users {
				if u.ID == s.userID {
					s.lastSeen = now
					return *u, nil
				}
			}
		}
	}
	return auth.StoredUser{}, auth.ErrUnauthorized
}

func (m *MemoryStore) deleteSessions(keep func(*memSession) bool) {
	kept := m.sessions[:0]
	for _, s := range m.sessions {
		if keep(s) {
			kept = append(kept, s)
		}
	}
	m.sessions = kept
}

func (m *MemoryStore) DeleteSession(_ context.Context, tokenHash []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deleteSessions(func(s *memSession) bool { return !bytes.Equal(s.hash, tokenHash) })
	return nil
}

func (m *MemoryStore) DeleteUserSessions(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deleteSessions(func(s *memSession) bool { return s.userID != userID })
	return nil
}

func (m *MemoryStore) DeleteAccount(_ context.Context, userID string, emailIndex []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	kept := m.users[:0]
	found := false
	for _, u := range m.users {
		if u.ID == userID && bytes.Equal(u.EmailIndex, emailIndex) {
			found = true
			continue
		}
		kept = append(kept, u)
	}
	if !found {
		return auth.ErrUnauthorized
	}
	m.users = kept
	m.deleteSessions(func(s *memSession) bool { return s.userID != userID })
	codes := m.codes[:0]
	for _, c := range m.codes {
		if !bytes.Equal(c.index, emailIndex) {
			codes = append(codes, c)
		}
	}
	m.codes = codes
	return nil
}

func (m *MemoryStore) AccountRecord(_ context.Context, userID string) (auth.AccountRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := false
	for _, u := range m.users {
		if u.ID == userID {
			found = true
			break
		}
	}
	if !found {
		return auth.AccountRecord{}, auth.ErrUnauthorized
	}
	rec := auth.AccountRecord{Sessions: []auth.SessionRecord{}}
	for _, s := range m.sessions {
		if s.userID == userID {
			rec.Sessions = append(rec.Sessions, auth.SessionRecord{
				CreatedAt:  s.lastSeen,
				LastSeenAt: s.lastSeen,
				ExpiresAt:  s.expiresAt,
			})
		}
	}
	return rec, nil
}

func (m *MemoryStore) UpdateProfile(_ context.Context, userID string, update auth.ProfileUpdate) (auth.StoredUser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var target *auth.StoredUser
	for _, u := range m.users {
		if u.ID == userID {
			target = u
		} else if update.Username != nil && u.Username == *update.Username {
			return auth.StoredUser{}, auth.ErrUsernameUnavailable
		}
	}
	if target == nil {
		return auth.StoredUser{}, auth.ErrUnauthorized
	}
	if update.DisplayName != nil {
		target.DisplayName = *update.DisplayName
	}
	if update.Username != nil {
		target.Username = *update.Username
	}
	return *target, nil
}

func (m *MemoryStore) DeleteExpired(context.Context, time.Time, time.Time) error { return nil }

// CapturedMail records the last code sent to each address.
type CapturedMail struct {
	mu    sync.Mutex
	codes map[string]string
	Fail  bool
}

func (c *CapturedMail) SendLoginCode(_ context.Context, to, code string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Fail {
		return fmt.Errorf("provider down")
	}
	if c.codes == nil {
		c.codes = map[string]string{}
	}
	c.codes[to] = code
	return nil
}

func (c *CapturedMail) Last(to string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.codes[to]
}
