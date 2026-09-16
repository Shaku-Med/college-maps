package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"regexp"
	"strings"
)

var envKey = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)

// LoadEnvFile reads .env.development or .env.production based on APP_ENV. Hosts set APP_ENV=production
// themselves; when it is unset the server assumes a laptop and uses development. Production never
// falls back to development values, because config.Load still rejects anything unsafe for production.
func LoadEnvFile() (env, file string, err error) {
	env = os.Getenv("APP_ENV")
	if env == "" {
		env = "development"
	}
	if env != "development" && env != "production" {
		return "", "", errors.New("APP_ENV must be development or production")
	}

	file = ".env." + env
	if err := LoadDotEnv(file); err != nil {
		return "", "", err
	}
	if got := os.Getenv("APP_ENV"); got != env {
		return "", "", fmt.Errorf("%s sets APP_ENV=%s, but it was loaded for %s", file, got, env)
	}
	return env, file, nil
}

// LoadDotEnv fills unset variables from a KEY=value file. Variables already set in the environment win,
// and a missing file is fine because hosts usually set variables directly.
func LoadDotEnv(path string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
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
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		if _, set := os.LookupEnv(key); !set {
			if err := os.Setenv(key, value); err != nil {
				return err
			}
		}
	}
	return nil
}
