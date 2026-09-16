package ticket

import (
	"errors"
	"strings"
	"testing"
	"time"
)

var secret = []byte(strings.Repeat("t", 40))

func claims(now time.Time) Claims {
	return Claims{Room: "meetup_abc123", Member: "member_xyz789", Name: "Jane Doe", Expires: now.Add(10 * time.Minute).Unix()}
}

func TestRoundTrip(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	token, err := Sign(secret, claims(now))
	if err != nil {
		t.Fatal(err)
	}
	got, err := Verify(secret, token, now)
	if err != nil || got != claims(now) {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestRejectsTamperingAndExpiry(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	token, _ := Sign(secret, claims(now))
	payload, sig, _ := strings.Cut(token, ".")

	other := claims(now)
	other.Room = "meetup_other1"
	forged, _ := Sign([]byte(strings.Repeat("x", 40)), other)
	forgedPayload, _, _ := strings.Cut(forged, ".")

	for name, bad := range map[string]string{
		"empty":           "",
		"no signature":    payload,
		"swapped payload": forgedPayload + "." + sig,
		"wrong secret":    forged,
		"garbage":         "a.b",
		"too long":        strings.Repeat("a", 600),
	} {
		if _, err := Verify(secret, bad, now); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: got %v", name, err)
		}
	}

	if _, err := Verify(secret, token, now.Add(11*time.Minute)); !errors.Is(err, ErrExpired) {
		t.Fatalf("expired ticket: %v", err)
	}

	long := claims(now)
	long.Expires = now.Add(2 * time.Hour).Unix()
	longToken, _ := Sign(secret, long)
	if _, err := Verify(secret, longToken, now); !errors.Is(err, ErrInvalid) {
		t.Fatal("tickets living longer than MaxTTL must be rejected")
	}
}

func TestSignValidatesClaims(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	for _, mutate := range []func(*Claims){
		func(c *Claims) { c.Room = "short" },
		func(c *Claims) { c.Member = "has space in it" },
		func(c *Claims) { c.Name = "<script>" },
		func(c *Claims) { c.Name = strings.Repeat("x", 41) },
		func(c *Claims) { c.Name = "" },
	} {
		c := claims(now)
		mutate(&c)
		if _, err := Sign(secret, c); !errors.Is(err, ErrInvalid) {
			t.Errorf("claims %+v should be rejected", c)
		}
	}
}
