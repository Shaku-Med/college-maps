package config

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"os"
	"strings"
)

const NotificationEnvFile = ".env.notification"

func (c *Config) applyPush() {
	c.VAPIDPublic = strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY"))
	c.VAPIDPrivate = strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY"))
	c.VAPIDSubject = strings.TrimSpace(os.Getenv("VAPID_SUBJECT"))
	c.PushAvailable = validPush(c.VAPIDPublic, c.VAPIDPrivate, c.VAPIDSubject) == nil
}

// LoadNotificationFile reads VAPID keys from .env.notification when one exists, such as on a laptop that
// ran an older version of the API. It never creates the file: the keys are made and kept in the database
// instead, because hosts like Vercel have no disk that lasts. Anything read here only seeds the database
// the first time.
func LoadNotificationFile() error {
	if _, err := os.Stat(NotificationEnvFile); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	return overlayVAPIDFromFile(NotificationEnvFile)
}

// overlayVAPIDFromFile copies VAPID values from .env.notification when the process does not
// already have a non-empty value. Empty assignments in other env files do not block a real key.
func overlayVAPIDFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	for i, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		if !ok || !envKey.MatchString(key) {
			return fmt.Errorf("%s line %d must look like KEY=value", path, i+1)
		}
		if key != "VAPID_PUBLIC_KEY" && key != "VAPID_PRIVATE_KEY" && key != "VAPID_SUBJECT" {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		if value == "" || strings.TrimSpace(os.Getenv(key)) != "" {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return err
		}
	}
	return nil
}

// DefaultVAPIDSubject is the contact push services see for this server: the sending email address,
// otherwise the site itself.
func DefaultVAPIDSubject() string {
	if from, err := mail.ParseAddress(os.Getenv("EMAIL_FROM")); err == nil && from.Address != "" {
		return "mailto:" + from.Address
	}
	for _, entry := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		parsed, err := url.Parse(strings.TrimSpace(entry))
		if err == nil && parsed.Scheme == "https" && parsed.Host != "" {
			return parsed.Scheme + "://" + parsed.Host
		}
	}
	return "mailto:notifications@localhost"
}

// GenerateVAPIDKeys makes a new P-256 keypair in the form Web Push expects.
func GenerateVAPIDKeys() (public, private string, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	priv := make([]byte, 32)
	key.D.FillBytes(priv)
	pub := make([]byte, 65)
	pub[0] = 0x04
	key.PublicKey.X.FillBytes(pub[1:33])
	key.PublicKey.Y.FillBytes(pub[33:65])
	return base64.RawURLEncoding.EncodeToString(pub), base64.RawURLEncoding.EncodeToString(priv), nil
}

// ValidVAPID checks a keypair and contact before they are used to sign anything.
func ValidVAPID(public, private, subject string) error {
	return validPush(public, private, subject)
}

func validPush(public, private, subject string) error {
	if public == "" || private == "" || subject == "" {
		return errors.New("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT are required for notifications")
	}
	pub, err := decodeVAPID(public)
	if err != nil || len(pub) != 65 || pub[0] != 0x04 {
		return errors.New("VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 key")
	}
	priv, err := decodeVAPID(private)
	if err != nil || len(priv) != 32 {
		return errors.New("VAPID_PRIVATE_KEY must be a 32-byte P-256 scalar")
	}
	zero := true
	for _, b := range priv {
		if b != 0 {
			zero = false
			break
		}
	}
	if zero {
		return errors.New("VAPID_PRIVATE_KEY must not be empty")
	}
	return validVAPIDSubject(subject)
}

func validVAPIDSubject(subject string) error {
	if strings.HasPrefix(subject, "mailto:") {
		addr, err := mail.ParseAddress(strings.TrimPrefix(subject, "mailto:"))
		if err != nil || addr.Address == "" {
			return errors.New("VAPID_SUBJECT mailto: must be a real email address")
		}
		return nil
	}
	parsed, err := url.Parse(subject)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return errors.New("VAPID_SUBJECT must be mailto:you@example.com or https://your.app")
	}
	return nil
}

func decodeVAPID(value string) ([]byte, error) {
	enc := base64.RawURLEncoding
	if strings.ContainsAny(value, "+/") || strings.HasSuffix(value, "=") {
		enc = base64.StdEncoding
	}
	out, err := enc.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("not base64: %w", err)
	}
	return out, nil
}
