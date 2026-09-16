package ticket

import (
	"strings"
	"testing"
	"time"
)

// The same vector lives in bkapp and rtapp, so a change to signing in only one module fails here.
const sharedVector = "eyJyb29tIjoibWVldHVwX2FiYzEyMyIsInN1YiI6Im1lbWJlcl94eXo3ODkiLCJuYW1lIjoiSmFuZSBEb2UiLCJleHAiOjE4MDAwMDA2MDB9.eZrK4f6ZhuDSaV-7TlN65WKgmXlPZ6SHaE5kUfCQwG4"

func TestSharedVector(t *testing.T) {
	claims := Claims{Room: "meetup_abc123", Member: "member_xyz789", Name: "Jane Doe", Expires: 1_800_000_600}
	secret := []byte(strings.Repeat("t", 40))
	token, err := Sign(secret, claims)
	if err != nil || token != sharedVector {
		t.Fatalf("signing changed: %q %v", token, err)
	}
	if got, err := Verify(secret, sharedVector, time.Unix(1_800_000_000, 0)); err != nil || got != claims {
		t.Fatalf("verify: %+v %v", got, err)
	}
}
