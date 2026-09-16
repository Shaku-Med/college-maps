package config

import (
	"strings"
	"testing"
)

func setValid(t *testing.T) {
	t.Helper()
	t.Setenv("PORT", "8080")
	t.Setenv("APP_ENV", "development")
	t.Setenv("ALLOWED_ORIGINS", "http://localhost:3000")
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/csimap")
	t.Setenv("AUTH_SECRET", "Vq3xT9mLp2Rk7Wn4Zb8Hc6Jd1Fg5Ys0Ea")
	t.Setenv("TICKET_SECRET", "Hn5Rk2Wq8Zt4Lp7Xc1Vb9Md3Gs6Jf0Ya")
	t.Setenv("EMAIL_MODE", "log")
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("EMAIL_FROM", "")
	t.Setenv("CLIENT_IP_HEADER", "")
}

func TestLoadValidDevelopment(t *testing.T) {
	setValid(t)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := cfg.AllowedOrigins["http://localhost:3000"]; !ok || cfg.IsProduction() {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestLoadFailsClosed(t *testing.T) {
	cases := map[string]func(t *testing.T){
		"missing port":            func(t *testing.T) { t.Setenv("PORT", "") },
		"bad env":                 func(t *testing.T) { t.Setenv("APP_ENV", "staging") },
		"missing origins":         func(t *testing.T) { t.Setenv("ALLOWED_ORIGINS", "") },
		"missing database":        func(t *testing.T) { t.Setenv("DATABASE_URL", "") },
		"not postgres":            func(t *testing.T) { t.Setenv("DATABASE_URL", "mysql://x@y/z") },
		"short secret":            func(t *testing.T) { t.Setenv("AUTH_SECRET", "short") },
		"missing ticket secret":   func(t *testing.T) { t.Setenv("TICKET_SECRET", "") },
		"ticket secret reused":    func(t *testing.T) { t.Setenv("TICKET_SECRET", "Vq3xT9mLp2Rk7Wn4Zb8Hc6Jd1Fg5Ys0Ea") },
		"low entropy secret":      func(t *testing.T) { t.Setenv("AUTH_SECRET", strings.Repeat("ab", 30)) },
		"bad email mode":          func(t *testing.T) { t.Setenv("EMAIL_MODE", "smtp") },
		"resend without key":      func(t *testing.T) { t.Setenv("EMAIL_MODE", "resend") },
		"bad client ip header":    func(t *testing.T) { t.Setenv("CLIENT_IP_HEADER", "Bad Header!") },
		"http origin not local":   func(t *testing.T) { t.Setenv("ALLOWED_ORIGINS", "http://csimap.example.com") },
		"origin with path":        func(t *testing.T) { t.Setenv("ALLOWED_ORIGINS", "https://csimap.example.com/app") },
		"log email in production": func(t *testing.T) { t.Setenv("APP_ENV", "production") },
		"production without ssl": func(t *testing.T) {
			t.Setenv("APP_ENV", "production")
			t.Setenv("EMAIL_MODE", "resend")
			t.Setenv("RESEND_API_KEY", "re_test")
			t.Setenv("EMAIL_FROM", "CSI Map <signin@example.com>")
			t.Setenv("ALLOWED_ORIGINS", "https://csimap.example.com")
		},
		"production localhost origin": func(t *testing.T) {
			t.Setenv("APP_ENV", "production")
			t.Setenv("EMAIL_MODE", "resend")
			t.Setenv("RESEND_API_KEY", "re_test")
			t.Setenv("EMAIL_FROM", "CSI Map <signin@example.com>")
			t.Setenv("DATABASE_URL", "postgres://u:p@ep-x.neon.tech/db?sslmode=verify-full")
		},
		"production without certificate check": func(t *testing.T) {
			t.Setenv("APP_ENV", "production")
			t.Setenv("EMAIL_MODE", "resend")
			t.Setenv("RESEND_API_KEY", "re_test")
			t.Setenv("EMAIL_FROM", "CSI Map <signin@example.com>")
			t.Setenv("ALLOWED_ORIGINS", "https://csimap.example.com")
			t.Setenv("DATABASE_URL", "postgres://u:p@ep-x.neon.tech/db?sslmode=require")
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			setValid(t)
			mutate(t)
			if _, err := Load(); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestLoadValidProduction(t *testing.T) {
	setValid(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("EMAIL_MODE", "resend")
	t.Setenv("RESEND_API_KEY", "re_test")
	t.Setenv("EMAIL_FROM", "CSI Map <signin@example.com>")
	t.Setenv("ALLOWED_ORIGINS", "https://csimap.example.com")
	t.Setenv("DATABASE_URL", "postgres://u:p@ep-x.neon.tech/db?sslmode=verify-full")
	t.Setenv("CLIENT_IP_HEADER", "Fly-Client-IP")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
}

func setGmail(t *testing.T) {
	t.Helper()
	t.Setenv("EMAIL_MODE", "smtp")
	t.Setenv("SMTP_HOST", "smtp.gmail.com")
	t.Setenv("SMTP_PORT", "587")
	t.Setenv("SMTP_USERNAME", "csimap.signin@gmail.com")
	t.Setenv("SMTP_PASSWORD", "abcd efgh ijkl mnop")
	t.Setenv("EMAIL_FROM", "CSI Map <csimap.signin@gmail.com>")
}

func TestLoadGmailSMTP(t *testing.T) {
	setValid(t)
	setGmail(t)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SMTPPort != 587 || cfg.SMTPPassword != "abcdefghijklmnop" {
		t.Fatalf("unexpected smtp config: port %d password length %d", cfg.SMTPPort, len(cfg.SMTPPassword))
	}
}

func TestSMTPFailsClosed(t *testing.T) {
	cases := map[string]func(t *testing.T){
		"bad host":          func(t *testing.T) { t.Setenv("SMTP_HOST", "not a host") },
		"plain port":        func(t *testing.T) { t.Setenv("SMTP_PORT", "25") },
		"missing password":  func(t *testing.T) { t.Setenv("SMTP_PASSWORD", "") },
		"missing username":  func(t *testing.T) { t.Setenv("SMTP_USERNAME", "") },
		"gmail sender swap": func(t *testing.T) { t.Setenv("EMAIL_FROM", "CSI Map <someone.else@gmail.com>") },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			setValid(t)
			setGmail(t)
			mutate(t)
			if _, err := Load(); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func setGmailAPI(t *testing.T) {
	t.Helper()
	t.Setenv("EMAIL_MODE", "gmail")
	t.Setenv("GMAIL_CLIENT_ID", "1234567890-abcdef.apps.googleusercontent.com")
	t.Setenv("GMAIL_CLIENT_SECRET", "GOCSPX-0123456789abcdef")
	t.Setenv("GMAIL_REFRESH_TOKEN", "1//0gAbCdEfGhIjKlMnOpQrStUvWxYz")
	t.Setenv("EMAIL_FROM", "CSI Map <csimap.signin@gmail.com>")
}

func TestLoadGmailAPI(t *testing.T) {
	setValid(t)
	setGmailAPI(t)
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.EmailMode != EmailModeGmail || cfg.GmailRefresh == "" || cfg.GmailClientID == "" || cfg.GmailSecret == "" {
		t.Fatalf("unexpected gmail config: %+v", cfg.EmailMode)
	}
}

func TestGmailAPIFailsClosed(t *testing.T) {
	cases := map[string]func(t *testing.T){
		"missing client id": func(t *testing.T) { t.Setenv("GMAIL_CLIENT_ID", "") },
		"foreign client id": func(t *testing.T) { t.Setenv("GMAIL_CLIENT_ID", "abc.example.com") },
		"missing secret":    func(t *testing.T) { t.Setenv("GMAIL_CLIENT_SECRET", "") },
		"missing refresh":   func(t *testing.T) { t.Setenv("GMAIL_REFRESH_TOKEN", "") },
		"short refresh":     func(t *testing.T) { t.Setenv("GMAIL_REFRESH_TOKEN", "1//short") },
		"missing sender":    func(t *testing.T) { t.Setenv("EMAIL_FROM", "") },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			setValid(t)
			setGmailAPI(t)
			mutate(t)
			if _, err := Load(); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestLocalNetworkOriginsOnlyInDevelopment(t *testing.T) {
	setValid(t)
	t.Setenv("ALLOWED_ORIGINS", "http://localhost:3000,http://192.168.1.169:3000,http://10.0.0.5:3000")
	if _, err := Load(); err != nil {
		t.Fatalf("development should accept local network origins: %v", err)
	}
	t.Setenv("ALLOWED_ORIGINS", "http://8.8.8.8:3000")
	if _, err := Load(); err == nil {
		t.Fatal("a public address over http must be rejected")
	}

	setValid(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("EMAIL_MODE", "resend")
	t.Setenv("RESEND_API_KEY", "re_test")
	t.Setenv("EMAIL_FROM", "CSI Map <signin@example.com>")
	t.Setenv("DATABASE_URL", "postgres://u:p@ep-x.neon.tech/db?sslmode=verify-full")
	t.Setenv("ALLOWED_ORIGINS", "http://192.168.1.169:3000")
	if _, err := Load(); err == nil {
		t.Fatal("production must reject http local network origins")
	}
}
