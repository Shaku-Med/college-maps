// Package migrations holds the database schema as plain SQL files, applied in filename order.
// Add a change as a new file like 0002_meetups.sql; never edit a file that has already run.
package migrations

import "embed"

//go:embed *.sql
var Files embed.FS
