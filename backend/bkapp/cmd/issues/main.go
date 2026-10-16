// Command issues, owner only: go run ./cmd/issues [-days 30]. Shows a reporter's email only if they said we may write.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/db"
)

func main() {
	days := flag.Int("days", 30, "how many days back to list")
	flag.Parse()
	if *days < 1 || *days > 3650 {
		fmt.Fprintln(os.Stderr, "issues: -days must be between 1 and 3650")
		os.Exit(2)
	}
	if err := run(*days); err != nil {
		fmt.Fprintln(os.Stderr, "issues:", err)
		os.Exit(1)
	}
}

func run(days int) error {
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
	accounts, err := admin.List(ctx)
	if err != nil {
		return err
	}
	byID := make(map[string]auth.Account, len(accounts))
	for _, account := range accounts {
		byID[account.ID] = account
	}

	rows, err := pool.Query(ctx, `
		select reporter_id::text, kind, coalesce(place_id, '-'), platform, coalesce(app_version, '-'), may_contact, message, created_at
		from issue_reports
		where created_at > now() - make_interval(days => $1)
		order by created_at desc`, days)
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var reporter, kind, place, platform, version, message string
		var mayContact bool
		var at time.Time
		if err := rows.Scan(&reporter, &kind, &place, &platform, &version, &mayContact, &message, &at); err != nil {
			return err
		}
		count++
		from := "a deleted account"
		if account, ok := byID[reporter]; ok {
			from = "@" + dash(account.Username)
			if mayContact && !account.Unreadable {
				from += " <" + account.Email + ">"
			}
		}
		fmt.Printf("%s  %-5s  place %-4s  %s %s  from %s\n", at.Local().Format("2006-01-02 15:04"), kind, place, platform, version, from)
		for _, line := range strings.Split(message, "\n") {
			fmt.Printf("    %s\n", line)
		}
		fmt.Println()
	}
	if err := rows.Err(); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "%d report(s) in the last %d days in the %s database\n", count, days, env)
	return nil
}

func dash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
