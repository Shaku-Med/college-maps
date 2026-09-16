package config

import (
	"os"
	"strings"
	"testing"
)

func TestEnsureNotificationEnvCreatesOnce(t *testing.T) {
	inTempDir(t)
	unset(t, "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "EMAIL_FROM", "ALLOWED_ORIGINS")
	t.Setenv("EMAIL_FROM", "CSI Map <ops@example.com>")

	if err := EnsureNotificationEnv(); err != nil {
		t.Fatal(err)
	}
	firstPub := os.Getenv("VAPID_PUBLIC_KEY")
	firstPriv := os.Getenv("VAPID_PRIVATE_KEY")
	if err := validPush(firstPub, firstPriv, os.Getenv("VAPID_SUBJECT")); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(NotificationEnvFile)
	if err != nil || !strings.Contains(string(body), firstPub) {
		t.Fatalf("file should contain the generated public key: %v", err)
	}

	unset(t, "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT")
	if err := EnsureNotificationEnv(); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("VAPID_PUBLIC_KEY") != firstPub || os.Getenv("VAPID_PRIVATE_KEY") != firstPriv {
		t.Fatal("an existing .env.notification must not be regenerated")
	}
}

func TestEnsureNotificationEnvLeavesEmptyFileAlone(t *testing.T) {
	inTempDir(t)
	unset(t, "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT")
	writeFile(t, NotificationEnvFile, "VAPID_PUBLIC_KEY=\nVAPID_PRIVATE_KEY=\nVAPID_SUBJECT=\n")
	if err := EnsureNotificationEnv(); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("VAPID_PUBLIC_KEY") != "" {
		t.Fatal("empty keys in an existing file must not be replaced")
	}
}

func TestLoadWithoutVAPIDStillStarts(t *testing.T) {
	setValid(t)
	unset(t, "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PushAvailable {
		t.Fatal("push must stay off when VAPID values are missing")
	}
}

func TestLoadRejectsEmptyVAPIDValues(t *testing.T) {
	setValid(t)
	t.Setenv("VAPID_PUBLIC_KEY", "   ")
	t.Setenv("VAPID_PRIVATE_KEY", "aaaa")
	t.Setenv("VAPID_SUBJECT", "mailto:ops@example.com")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PushAvailable {
		t.Fatal("blank VAPID keys must disable notifications without failing the server")
	}
}

func TestLoadAcceptsGeneratedVAPID(t *testing.T) {
	setValid(t)
	pub, priv, err := generateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("VAPID_PUBLIC_KEY", pub)
	t.Setenv("VAPID_PRIVATE_KEY", priv)
	t.Setenv("VAPID_SUBJECT", "https://csimap.example.com")
	cfg, err := Load()
	if err != nil || !cfg.PushAvailable || cfg.VAPIDPublic != pub {
		t.Fatalf("generated keys should enable push: %v %+v", err, cfg)
	}
}

func TestNotificationFileFillsEmptyEnv(t *testing.T) {
	inTempDir(t)
	pub, priv, err := generateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, NotificationEnvFile, "VAPID_PUBLIC_KEY="+pub+"\nVAPID_PRIVATE_KEY="+priv+"\nVAPID_SUBJECT=mailto:ops@example.com\n")
	t.Setenv("VAPID_PUBLIC_KEY", "")
	t.Setenv("VAPID_PRIVATE_KEY", "")
	t.Setenv("VAPID_SUBJECT", "")
	if err := EnsureNotificationEnv(); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("VAPID_PUBLIC_KEY") != pub || os.Getenv("VAPID_PRIVATE_KEY") != priv {
		t.Fatal("non-empty keys in .env.notification must win over empty environment values")
	}
}

func TestValidVAPIDSubject(t *testing.T) {
	if err := validVAPIDSubject("mailto:ops@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := validVAPIDSubject("https://csimap.example.com"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "ops@example.com", "http://csimap.example.com", "mailto:"} {
		if validVAPIDSubject(bad) == nil {
			t.Fatalf("expected %q to fail", bad)
		}
	}
}
