// Package ticket verifies the short-lived passes bkapp signs so rtapp never needs the database.
package ticket

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	// MaxTTL keeps revocation quick: someone removed from a meetup loses access when their ticket runs out.
	MaxTTL        = 15 * time.Minute
	clockSkew     = time.Minute
	maxTokenBytes = 512
	maxNameRunes  = 40
	signingPrefix = "csimap-rt-ticket:v1:"
)

var (
	ErrInvalid = errors.New("invalid ticket")
	ErrExpired = errors.New("ticket expired")

	idPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)
	namePattern = regexp.MustCompile(`^[\p{L}\p{M}\p{N} .'-]+$`)
)

// Claims hold opaque ids only. The member id is derived per meetup, so it never reveals a database id.
type Claims struct {
	Room    string `json:"room"`
	Member  string `json:"sub"`
	Name    string `json:"name"`
	Expires int64  `json:"exp"`
}

func (c Claims) ExpiresAt() time.Time {
	return time.Unix(c.Expires, 0)
}

func (c Claims) valid() bool {
	return idPattern.MatchString(c.Room) &&
		idPattern.MatchString(c.Member) &&
		utf8.RuneCountInString(c.Name) <= maxNameRunes &&
		strings.TrimSpace(c.Name) == c.Name &&
		namePattern.MatchString(c.Name)
}

func signature(secret []byte, payload string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingPrefix + payload))
	return mac.Sum(nil)
}

func Sign(secret []byte, c Claims) (string, error) {
	if !c.valid() || c.Expires <= 0 {
		return "", ErrInvalid
	}
	body, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(body)
	token := payload + "." + base64.RawURLEncoding.EncodeToString(signature(secret, payload))
	if len(token) > maxTokenBytes {
		return "", ErrInvalid
	}
	return token, nil
}

func Verify(secret []byte, token string, now time.Time) (Claims, error) {
	if token == "" || len(token) > maxTokenBytes {
		return Claims{}, ErrInvalid
	}
	payload, sig, ok := strings.Cut(token, ".")
	if !ok {
		return Claims{}, ErrInvalid
	}
	given, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(given, signature(secret, payload)) {
		return Claims{}, ErrInvalid
	}
	body, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return Claims{}, ErrInvalid
	}

	var c Claims
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&c); err != nil || decoder.More() || !c.valid() {
		return Claims{}, ErrInvalid
	}
	expires := c.ExpiresAt()
	if !expires.After(now) {
		return Claims{}, ErrExpired
	}
	if expires.After(now.Add(MaxTTL + clockSkew)) {
		return Claims{}, ErrInvalid
	}
	return c, nil
}
