package app

import (
	"sync"
	"time"
)

// Reports are always stored; these caps only limit how many reach the support inbox in a day.
const (
	maxReportAlertsDay         = 25
	maxReportAlertsReporterDay = 3
)

type reportAlertGate struct {
	mu   sync.Mutex
	day  string
	sent int
	by   map[string]int
}

func (g *reportAlertGate) allow(reporter string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if day := now.UTC().Format(time.DateOnly); day != g.day || g.by == nil {
		g.day, g.sent, g.by = day, 0, map[string]int{}
	}
	if g.sent >= maxReportAlertsDay || g.by[reporter] >= maxReportAlertsReporterDay {
		return false
	}
	g.sent++
	g.by[reporter]++
	return true
}
