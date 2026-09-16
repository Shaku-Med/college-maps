package auth

import (
	"bytes"
	"strings"
	"testing"
)

func TestEmailSealing(t *testing.T) {
	keys, err := DeriveKeys([]byte(strings.Repeat("s", 40)))
	if err != nil {
		t.Fatal(err)
	}
	addr := "jane.doe12@stu-mail.csi.cuny.edu"
	index := keys.EmailIndex(addr)

	a, _ := keys.sealEmail(addr, index)
	b, _ := keys.sealEmail(addr, index)
	if bytes.Equal(a, b) {
		t.Fatal("each seal must use a fresh nonce")
	}
	if got, err := keys.openEmail(a, index); err != nil || got != addr {
		t.Fatalf("open: %q %v", got, err)
	}

	flipped := append([]byte(nil), a...)
	flipped[len(flipped)-1] ^= 1
	if _, err := keys.openEmail(flipped, index); err == nil {
		t.Fatal("a modified ciphertext must fail")
	}
	if _, err := keys.openEmail(a, keys.EmailIndex("someone.else@stu-mail.csi.cuny.edu")); err == nil {
		t.Fatal("a ciphertext must only open for its own row")
	}
	if _, err := keys.openEmail(a[:10], index); err == nil {
		t.Fatal("a truncated ciphertext must fail")
	}

	other, _ := DeriveKeys([]byte(strings.Repeat("t", 40)))
	if _, err := other.openEmail(a, index); err == nil {
		t.Fatal("a different secret must not decrypt")
	}
}

func TestDerivedKeysAreIndependent(t *testing.T) {
	keys, _ := DeriveKeys([]byte(strings.Repeat("s", 40)))
	if bytes.Equal(keys.code, keys.index) || bytes.Equal(keys.index, keys.session) || bytes.Equal(keys.code, keys.session) {
		t.Fatal("each purpose needs its own key")
	}
	if bytes.Equal(keyedHash(keys.code, []byte("ab"), []byte("c")), keyedHash(keys.code, []byte("a"), []byte("bc"))) {
		t.Fatal("different splits of the same bytes must not collide")
	}
}
