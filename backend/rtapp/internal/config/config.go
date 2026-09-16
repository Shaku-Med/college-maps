package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const minSecretLength = 32

var headerName = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

type Config struct {
	Port           int
	Env            string
	AllowedOrigins map[string]struct{}
	TicketSecret   []byte
	ClientIPHeader string
}

func (c Config) IsProduction() bool {
	return c.Env == "production"
}

func Load() (Config, error) {
	var errs []error
	cfg := Config{}

	port, err := strconv.Atoi(os.Getenv("PORT"))
	if err != nil || port < 1 || port > 65535 {
		errs = append(errs, errors.New("PORT must be a number between 1 and 65535"))
	}
	cfg.Port = port

	cfg.Env = os.Getenv("APP_ENV")
	if cfg.Env != "development" && cfg.Env != "production" {
		errs = append(errs, errors.New("APP_ENV must be development or production"))
	}

	cfg.AllowedOrigins, err = origins(os.Getenv("ALLOWED_ORIGINS"), cfg.IsProduction())
	if err != nil {
		errs = append(errs, err)
	}

	secret := os.Getenv("TICKET_SECRET")
	if len(secret) < minSecretLength {
		errs = append(errs, fmt.Errorf("TICKET_SECRET must be at least %d characters of random text", minSecretLength))
	}
	cfg.TicketSecret = []byte(secret)

	if header := os.Getenv("CLIENT_IP_HEADER"); header != "" {
		if !headerName.MatchString(header) {
			errs = append(errs, errors.New("CLIENT_IP_HEADER must be a header name like Fly-Client-IP"))
		}
		cfg.ClientIPHeader = header
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func origins(raw string, production bool) (map[string]struct{}, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("ALLOWED_ORIGINS is required, like https://csimap.example.com")
	}
	list := map[string]struct{}{}
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		parsed, err := url.Parse(entry)
		local := err == nil && isLocalHost(parsed.Hostname())
		validScheme := err == nil && (parsed.Scheme == "https" || (parsed.Scheme == "http" && local && !production))
		if !validScheme || parsed.Host == "" || (parsed.Path != "" && parsed.Path != "/") {
			return nil, fmt.Errorf("ALLOWED_ORIGINS has an invalid origin %q (use https://host, or http://localhost or a local network address in development)", entry)
		}
		list[parsed.Scheme+"://"+parsed.Host] = struct{}{}
	}
	return list, nil
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
