package config

import (
	"os"
	"testing"
)

// Keys are made in the database now. A file is only read, so a host with a read-only disk never fails here.
func TestNotificationFileIsNeverCreated(t *testing.T) {
	inTempDir(t)
	unset(t, "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT")
	if err := LoadNotificationFile(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(NotificationEnvFile); !os.IsNotExist(err) {
		t.Fatalf("the keys file should not be created: %v", err)
	}
	if os.Getenv("VAPID_PUBLIC_KEY") != "" {
		t.Fatal("no keys should appear without a file")
	}
}

func TestNotificationFileLeavesEmptyValuesAlone(t *testing.T) {
	inTempDir(t)
	unset(t, "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT")
	writeFile(t, NotificationEnvFile, "VAPID_PUBLIC_KEY=\nVAPID_PRIVATE_KEY=\nVAPID_SUBJECT=\n")
	if err := LoadNotificationFile(); err != nil {
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
	pub, priv, err := GenerateVAPIDKeys()
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
	pub, priv, err := GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, NotificationEnvFile, "VAPID_PUBLIC_KEY="+pub+"\nVAPID_PRIVATE_KEY="+priv+"\nVAPID_SUBJECT=mailto:ops@example.com\n")
	t.Setenv("VAPID_PUBLIC_KEY", "")
	t.Setenv("VAPID_PRIVATE_KEY", "")
	t.Setenv("VAPID_SUBJECT", "")
	if err := LoadNotificationFile(); err != nil {
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
