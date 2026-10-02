// Package migrations holds the schema as SQL files run in name order. Never edit a file that has already run.
package migrations

import "embed"

//go:embed *.sql
var Files embed.FS
