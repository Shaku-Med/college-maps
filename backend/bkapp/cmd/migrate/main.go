// Command migrate applies the SQL files in migrations/ without starting the API.
// The API also runs this on startup, so it is only needed to prepare a database ahead of time.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"csimap/bkapp/internal/config"
	"csimap/bkapp/internal/db"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run() error {
	env, file, err := config.LoadEnvFile()
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

	applied, err := db.Migrate(ctx, pool)
	if err != nil {
		return err
	}
	fmt.Printf("%s database (settings from %s)\n", env, file)
	if len(applied) == 0 {
		fmt.Println("already up to date")
	}
	for _, name := range applied {
		fmt.Println("applied", name)
	}
	return nil
}
