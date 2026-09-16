package config

import (
	"os"
	"strings"
	"testing"
)

func inTempDir(t *testing.T) {
	t.Helper()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(previous) })
}

func unset(t *testing.T, keys ...string) {
	t.Helper()
	for _, key := range keys {
		t.Setenv(key, "")
		os.Unsetenv(key)
	}
}

func writeFile(t *testing.T, name, body string) {
	t.Helper()
	if err := os.WriteFile(name, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLoadEnvFileChoosesByAppEnv(t *testing.T) {
	inTempDir(t)
	writeFile(t, ".env.development", "APP_ENV=development\nENVTEST_VALUE=dev\n")
	writeFile(t, ".env.production", "APP_ENV=production\nENVTEST_VALUE=prod\n")

	unset(t, "APP_ENV", "ENVTEST_VALUE")
	env, file, err := LoadEnvFile()
	if err != nil || env != "development" || file != ".env.development" || os.Getenv("ENVTEST_VALUE") != "dev" {
		t.Fatalf("default: %s %s %v %q", env, file, err, os.Getenv("ENVTEST_VALUE"))
	}

	unset(t, "ENVTEST_VALUE")
	t.Setenv("APP_ENV", "production")
	env, _, err = LoadEnvFile()
	if err != nil || env != "production" || os.Getenv("ENVTEST_VALUE") != "prod" {
		t.Fatalf("production: %s %v %q", env, err, os.Getenv("ENVTEST_VALUE"))
	}

	t.Setenv("APP_ENV", "staging")
	if _, _, err := LoadEnvFile(); err == nil {
		t.Fatal("unknown APP_ENV must fail")
	}

	writeFile(t, ".env.development", "APP_ENV=production\n")
	unset(t, "APP_ENV")
	if _, _, err := LoadEnvFile(); err == nil || !strings.Contains(err.Error(), "loaded for development") {
		t.Fatalf("mismatched file must fail, got %v", err)
	}
}

func TestLoadDotEnvKeepsRealEnvironment(t *testing.T) {
	inTempDir(t)
	writeFile(t, "vars.env", "# comment\nDOTENV_A=from file\nexport DOTENV_B=\"quoted value\"\nDOTENV_C=kept\n")
	unset(t, "DOTENV_A", "DOTENV_B")
	t.Setenv("DOTENV_C", "from shell")

	if err := LoadDotEnv("vars.env"); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("DOTENV_A") != "from file" || os.Getenv("DOTENV_B") != "quoted value" || os.Getenv("DOTENV_C") != "from shell" {
		t.Fatalf("got %q %q %q", os.Getenv("DOTENV_A"), os.Getenv("DOTENV_B"), os.Getenv("DOTENV_C"))
	}

	writeFile(t, "bad.env", "not a pair\n")
	if LoadDotEnv("bad.env") == nil {
		t.Fatal("malformed lines must fail")
	}
	if LoadDotEnv("missing.env") != nil {
		t.Fatal("a missing file is fine")
	}
}
