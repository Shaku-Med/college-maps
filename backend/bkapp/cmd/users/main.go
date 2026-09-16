// Command users shows accounts with their decrypted emails, for the app owner only.
//
//	go run ./cmd/users                        list every account
//	go run ./cmd/users -find name@school.edu  look up one account
//	go run ./cmd/users -csv > users.csv       export for a spreadsheet
//
// It uses the same settings file as the API, so APP_ENV=production reads the production database.
package main

import (
	"context"
	"encoding/csv"
	"flag"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/db"
)

func main() {
	find := flag.String("find", "", "email address to look up")
	asCSV := flag.Bool("csv", false, "print CSV instead of a table")
	flag.Parse()

	if err := run(*find, *asCSV); err != nil {
		fmt.Fprintln(os.Stderr, "users:", err)
		os.Exit(1)
	}
}

func run(find string, asCSV bool) error {
	env, _, err := config.LoadEnvFile()
	if err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	admin, err := auth.NewAdmin(pool, cfg.AuthSecret)
	if err != nil {
		return err
	}

	var accounts []auth.Account
	if find != "" {
		account, err := admin.Find(ctx, strings.ToLower(strings.TrimSpace(find)))
		if err != nil {
			return err
		}
		if account == nil {
			return fmt.Errorf("no account for %s in the %s database", find, env)
		}
		accounts = []auth.Account{*account}
	} else if accounts, err = admin.List(ctx); err != nil {
		return err
	}

	if asCSV {
		w := csv.NewWriter(os.Stdout)
		_ = w.Write([]string{"email", "username", "display_name", "created_at", "last_login_at"})
		for _, a := range accounts {
			_ = w.Write([]string{emailLabel(a), a.Username, a.DisplayName, a.CreatedAt.Format(time.RFC3339), formatTime(a.LastLoginAt)})
		}
		w.Flush()
		return w.Error()
	}

	unreadable := 0
	for _, a := range accounts {
		if a.Unreadable {
			unreadable++
		}
	}
	fmt.Fprintf(os.Stderr, "%d account(s) in the %s database\n", len(accounts), env)
	if unreadable > 0 {
		fmt.Fprintf(os.Stderr, "%d email(s) were saved with a different AUTH_SECRET and cannot be read with this one\n", unreadable)
	}
	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "EMAIL\tUSERNAME\tNAME\tJOINED\tLAST SIGN IN")
	for _, a := range accounts {
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", emailLabel(a), dash(a.Username), dash(a.DisplayName), a.CreatedAt.Format("2006-01-02"), formatTime(a.LastLoginAt))
	}
	return tw.Flush()
}

func emailLabel(a auth.Account) string {
	if a.Unreadable {
		return "(unreadable with this AUTH_SECRET)"
	}
	return a.Email
}

func formatTime(t *time.Time) string {
	if t == nil {
		return "-"
	}
	return t.Local().Format("2006-01-02 15:04")
}

func dash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
