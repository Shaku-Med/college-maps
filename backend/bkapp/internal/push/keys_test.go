package push

import (
	"bytes"
	"errors"
	"regexp"
	"strings"
	"testing"
)

var testSecret = []byte(strings.Repeat("k", 40))

func TestSealedKeysOpenWithTheSameSecret(t *testing.T) {
	aead, err := sealer(testSecret)
	if err != nil {
		t.Fatal(err)
	}
	plain := []byte(`{"private":"a secret"}`)
	sealed, err := seal(aead, "vapid", plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("a secret")) {
		t.Fatal("the sealed value contains the plain text")
	}
	opened, err := open(aead, "vapid", sealed)
	if err != nil || !bytes.Equal(opened, plain) {
		t.Fatalf("opened %q, %v", opened, err)
	}
	again, _ := seal(aead, "vapid", plain)
	if bytes.Equal(sealed, again) {
		t.Fatal("sealing the same value twice must not give the same bytes")
	}
}

func TestSealedKeysRefuseAnythingElse(t *testing.T) {
	aead, _ := sealer(testSecret)
	sealed, _ := seal(aead, "vapid", []byte(`{"private":"a secret"}`))

	other, _ := sealer([]byte(strings.Repeat("z", 40)))
	if _, err := open(other, "vapid", sealed); !errors.Is(err, ErrKeysUnreadable) {
		t.Errorf("a different AUTH_SECRET opened the keys: %v", err)
	}
	if _, err := open(aead, "another_row", sealed); !errors.Is(err, ErrKeysUnreadable) {
		t.Errorf("keys moved to another row still opened: %v", err)
	}
	tampered := append([]byte(nil), sealed...)
	tampered[len(tampered)-1] ^= 1
	if _, err := open(aead, "vapid", tampered); !errors.Is(err, ErrKeysUnreadable) {
		t.Errorf("tampered keys opened: %v", err)
	}
	wrongVersion := append([]byte(nil), sealed...)
	wrongVersion[0] = 9
	if _, err := open(aead, "vapid", wrongVersion); !errors.Is(err, ErrKeysUnreadable) {
		t.Errorf("an unknown format opened: %v", err)
	}
	if _, err := open(aead, "vapid", sealed[:10]); !errors.Is(err, ErrKeysUnreadable) {
		t.Errorf("a truncated value opened: %v", err)
	}
}

func TestSealerNeedsARealSecret(t *testing.T) {
	if _, err := sealer([]byte("short")); err == nil {
		t.Fatal("a short secret must be refused")
	}
}

// A laptop and production share one database but not one secret, so each must get a row of its own.
func TestEachSecretGetsItsOwnRow(t *testing.T) {
	laptop := keyRow([]byte(strings.Repeat("d", 40)))
	production := keyRow([]byte(strings.Repeat("p", 40)))
	if laptop == production {
		t.Fatal("two secrets share one row")
	}
	if keyRow([]byte(strings.Repeat("p", 40))) != production {
		t.Fatal("the same secret must always find the same row")
	}
	// The same rule the database enforces on app_keys.name.
	allowed := regexp.MustCompile(`^[a-z][a-z0-9_]{1,40}$`)
	for _, row := range []string{laptop, production} {
		if !allowed.MatchString(row) {
			t.Errorf("%q would be refused by the database", row)
		}
		if strings.Contains(row, "ddd") || strings.Contains(row, "ppp") {
			t.Errorf("%q leaks the secret", row)
		}
	}
}
