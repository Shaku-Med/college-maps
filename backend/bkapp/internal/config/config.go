package config

import (
	"errors"
	"fmt"
	"net"
	"net/mail"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	EmailModeResend = "resend"
	EmailModeSMTP   = "smtp"
	EmailModeGmail  = "gmail"
	EmailModeLog    = "log"
	minSecretLength = 32
)

var (
	headerName     = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)
	hostName       = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$`)
	googleClientID = regexp.MustCompile(`^[A-Za-z0-9-]{1,128}\.apps\.googleusercontent\.com$`)
	opaqueSecret   = regexp.MustCompile(`^[A-Za-z0-9._~+/=-]{20,512}$`)
)

type Config struct {
	Port           int
	Env            string
	AllowedOrigins map[string]struct{}
	DatabaseURL    string
	AuthSecret     []byte
	TicketSecret   []byte
	EmailMode      string
	ResendAPIKey   string
	GmailClientID  string
	GmailSecret    string
	GmailRefresh   string
	SMTPHost       string
	SMTPPort       int
	SMTPUsername   string
	SMTPPassword   string
	EmailFrom      string
	CronSecret     string
	ClientIPHeader string
	PushAvailable  bool
	VAPIDPublic    string
	VAPIDPrivate   string
	VAPIDSubject   string
}

func (c Config) IsProduction() bool {
	return c.Env == "production"
}

func Load() (Config, error) {
	var errs []error
	add := func(err error) {
		if err != nil {
			errs = append(errs, err)
		}
	}

	cfg := Config{}
	var err error

	cfg.Port, err = requiredPort("PORT")
	add(err)
	cfg.Env, err = requiredOneOf("APP_ENV", "development", "production")
	add(err)
	production := cfg.Env == "production"

	cfg.AllowedOrigins, err = requiredOrigins("ALLOWED_ORIGINS", production)
	add(err)
	cfg.DatabaseURL, err = databaseURL("DATABASE_URL", production)
	add(err)

	secret := os.Getenv("AUTH_SECRET")
	if len(secret) < minSecretLength || distinctBytes(secret) < 16 {
		add(fmt.Errorf("AUTH_SECRET must be at least %d characters of random text, like the output of openssl rand -base64 48", minSecretLength))
	}
	cfg.AuthSecret = []byte(secret)

	ticketSecret := os.Getenv("TICKET_SECRET")
	if len(ticketSecret) < minSecretLength || distinctBytes(ticketSecret) < 16 {
		add(fmt.Errorf("TICKET_SECRET must be at least %d characters of random text, the same value rtapp uses", minSecretLength))
	} else if ticketSecret == secret {
		add(errors.New("TICKET_SECRET must be different from AUTH_SECRET"))
	}
	cfg.TicketSecret = []byte(ticketSecret)

	cfg.EmailMode, err = requiredOneOf("EMAIL_MODE", EmailModeSMTP, EmailModeGmail, EmailModeResend, EmailModeLog)
	add(err)
	if cfg.EmailMode == EmailModeLog && production {
		add(errors.New("EMAIL_MODE=log prints sign-in codes to the server log and is only allowed in development"))
	}
	if cfg.EmailMode == EmailModeGmail {
		cfg.GmailClientID = os.Getenv("GMAIL_CLIENT_ID")
		if !googleClientID.MatchString(cfg.GmailClientID) {
			add(errors.New("GMAIL_CLIENT_ID must be the client id from the Google Cloud console, ending in .apps.googleusercontent.com"))
		}
		cfg.GmailSecret = strings.TrimSpace(os.Getenv("GMAIL_CLIENT_SECRET"))
		if !opaqueSecret.MatchString(cfg.GmailSecret) {
			add(errors.New("GMAIL_CLIENT_SECRET is required when EMAIL_MODE=gmail"))
		}
		cfg.GmailRefresh = strings.TrimSpace(os.Getenv("GMAIL_REFRESH_TOKEN"))
		if !opaqueSecret.MatchString(cfg.GmailRefresh) {
			add(errors.New("GMAIL_REFRESH_TOKEN is required when EMAIL_MODE=gmail, create it with: go run ./cmd/gmailtoken"))
		}
	}
	if cfg.EmailMode == EmailModeResend {
		cfg.ResendAPIKey = os.Getenv("RESEND_API_KEY")
		if cfg.ResendAPIKey == "" {
			add(errors.New("RESEND_API_KEY is required when EMAIL_MODE=resend"))
		}
	}
	if cfg.EmailMode == EmailModeSMTP {
		cfg.SMTPHost = os.Getenv("SMTP_HOST")
		if !hostName.MatchString(cfg.SMTPHost) {
			add(errors.New("SMTP_HOST must be a mail server name like smtp.gmail.com"))
		}
		// 2525 is the usual way out when a host blocks the standard submission ports, as Render's
		// free plan does. Mail relays offer it with the same STARTTLS handshake as 587.
		cfg.SMTPPort, err = strconv.Atoi(os.Getenv("SMTP_PORT"))
		if err != nil || (cfg.SMTPPort != 465 && cfg.SMTPPort != 587 && cfg.SMTPPort != 2525) {
			add(errors.New("SMTP_PORT must be 587 or 2525 (STARTTLS) or 465 (TLS)"))
		}
		cfg.SMTPUsername = os.Getenv("SMTP_USERNAME")
		cfg.SMTPPassword = os.Getenv("SMTP_PASSWORD")
		// Google shows app passwords in groups of four; the spaces are not part of the password.
		if strings.EqualFold(cfg.SMTPHost, "smtp.gmail.com") {
			cfg.SMTPPassword = strings.ReplaceAll(cfg.SMTPPassword, " ", "")
		}
		if cfg.SMTPUsername == "" || cfg.SMTPPassword == "" {
			add(errors.New("SMTP_USERNAME and SMTP_PASSWORD are required when EMAIL_MODE=smtp"))
		}
	}
	if cfg.EmailMode == EmailModeResend || cfg.EmailMode == EmailModeSMTP || cfg.EmailMode == EmailModeGmail {
		cfg.EmailFrom = os.Getenv("EMAIL_FROM")
		from, err := mail.ParseAddress(cfg.EmailFrom)
		if err != nil {
			add(errors.New(`EMAIL_FROM must be a sender like "CSI Map <yourapp@gmail.com>"`))
		} else if cfg.EmailMode == EmailModeSMTP && strings.EqualFold(cfg.SMTPHost, "smtp.gmail.com") && !strings.EqualFold(from.Address, cfg.SMTPUsername) {
			add(errors.New("with Gmail, the address in EMAIL_FROM must be the same Gmail account as SMTP_USERNAME"))
		}
	}

	// Only needed where cleanup runs on a schedule instead of in the server's own loop.
	if cron := os.Getenv("CRON_SECRET"); cron != "" {
		if len(cron) < minSecretLength || distinctBytes(cron) < 16 {
			add(fmt.Errorf("CRON_SECRET must be at least %d characters of random text, or left unset", minSecretLength))
		}
		cfg.CronSecret = cron
	}

	if header := os.Getenv("CLIENT_IP_HEADER"); header != "" {
		if !headerName.MatchString(header) {
			add(errors.New("CLIENT_IP_HEADER must be a header name like Fly-Client-IP"))
		}
		cfg.ClientIPHeader = header
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	cfg.applyPush()
	return cfg, nil
}

func requiredPort(key string) (int, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return 0, fmt.Errorf("%s is required", key)
	}
	port, err := strconv.Atoi(raw)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("%s must be a number between 1 and 65535", key)
	}
	return port, nil
}

func requiredOneOf(key string, allowed ...string) (string, error) {
	raw := os.Getenv(key)
	for _, value := range allowed {
		if raw == value {
			return raw, nil
		}
	}
	return "", fmt.Errorf("%s must be one of %s", key, strings.Join(allowed, ", "))
}

// The web app signs in with cookies, so every browser origin that calls the API must be listed.
func requiredOrigins(key string, production bool) (map[string]struct{}, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil, fmt.Errorf("%s is required, like https://csimap.example.com", key)
	}
	origins := map[string]struct{}{}
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		parsed, err := url.Parse(entry)
		local := err == nil && isLocalHost(parsed.Hostname())
		validScheme := err == nil && (parsed.Scheme == "https" || (parsed.Scheme == "http" && local && !production))
		if !validScheme || parsed.Host == "" || (parsed.Path != "" && parsed.Path != "/") {
			return nil, fmt.Errorf("%s has an invalid origin %q (use https://host, or http://localhost or a local network address in development)", key, entry)
		}
		origins[parsed.Scheme+"://"+parsed.Host] = struct{}{}
	}
	return origins, nil
}

func databaseURL(key string, production bool) (string, error) {
	raw := os.Getenv(key)
	parsed, err := url.Parse(raw)
	if raw == "" || err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Host == "" {
		return "", fmt.Errorf("%s must be a postgres:// connection string (copy it from the Neon dashboard)", key)
	}
	// verify-full checks the server certificate, so a network attacker cannot pose as the database.
	if production && parsed.Query().Get("sslmode") != "verify-full" {
		return "", fmt.Errorf("%s must use sslmode=verify-full in production", key)
	}
	return raw, nil
}

func distinctBytes(value string) int {
	seen := map[byte]struct{}{}
	for i := 0; i < len(value); i++ {
		seen[value[i]] = struct{}{}
	}
	return len(seen)
}

// isLocalHost covers this computer and addresses on the home or campus network, so a phone on the
// same Wi-Fi can reach a development server. Production only ever accepts https.
func isLocalHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}
