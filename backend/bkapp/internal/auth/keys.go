package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
)

const (
	emailCipherVersion = 1
	nonceSize          = 12
)

var errCorruptEmail = errors.New("stored email could not be decrypted")

// Keys are derived from AUTH_SECRET with HMAC-SHA256 under distinct labels, so each purpose gets an
// independent 256 bit key and a leak of one derived value says nothing about the others.
type Keys struct {
	code    []byte
	index   []byte
	session []byte
	email   cipher.AEAD
}

func derive(master []byte, label string) []byte {
	mac := hmac.New(sha256.New, master)
	mac.Write([]byte("csimap/auth/v1/" + label))
	return mac.Sum(nil)
}

func DeriveKeys(master []byte) (*Keys, error) {
	if len(master) < 32 {
		return nil, errors.New("auth secret must be at least 32 bytes")
	}
	block, err := aes.NewCipher(derive(master, "email-encryption"))
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Keys{
		code:    derive(master, "login-code"),
		index:   derive(master, "email-index"),
		session: derive(master, "session-token"),
		email:   aead,
	}, nil
}

// keyedHash length-prefixes each part so different splits of the same bytes never collide.
func keyedHash(key []byte, parts ...[]byte) []byte {
	mac := hmac.New(sha256.New, key)
	for _, part := range parts {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(part)))
		mac.Write(length[:])
		mac.Write(part)
	}
	return mac.Sum(nil)
}

// EmailIndex is a blind index: the database can find and deduplicate accounts by email
// without ever holding the address, and the hash is useless without the server key.
func (k *Keys) EmailIndex(email string) []byte {
	return keyedHash(k.index, []byte(email))
}

func (k *Keys) codeHash(index []byte, code string) []byte {
	return keyedHash(k.code, index, []byte(code))
}

func (k *Keys) tokenHash(token string) []byte {
	return keyedHash(k.session, []byte(token))
}

// sealEmail encrypts with AES-256-GCM. The blind index is authenticated as associated data, so a
// ciphertext copied onto another account's row fails to decrypt instead of showing the wrong email.
func (k *Keys) sealEmail(email string, index []byte) ([]byte, error) {
	out := make([]byte, 1+nonceSize, 1+nonceSize+len(email)+k.email.Overhead())
	out[0] = emailCipherVersion
	if _, err := io.ReadFull(rand.Reader, out[1:]); err != nil {
		return nil, err
	}
	return k.email.Seal(out, out[1:], []byte(email), index), nil
}

func (k *Keys) openEmail(sealed, index []byte) (string, error) {
	if len(sealed) < 1+nonceSize+k.email.Overhead() || sealed[0] != emailCipherVersion {
		return "", errCorruptEmail
	}
	plain, err := k.email.Open(nil, sealed[1:1+nonceSize], sealed[1+nonceSize:], index)
	if err != nil {
		return "", errCorruptEmail
	}
	return string(plain), nil
}
