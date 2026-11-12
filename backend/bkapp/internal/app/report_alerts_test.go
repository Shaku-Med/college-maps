package app

import (
	"fmt"
	"testing"
	"time"
)

func TestReportAlertGate(t *testing.T) {
	var g reportAlertGate
	now := time.Date(2026, 11, 11, 12, 0, 0, 0, time.UTC)
	for i := 0; i < maxReportAlertsReporterDay; i++ {
		if !g.allow("@spam", now) {
			t.Fatal("first reports from one person should alert")
		}
	}
	if g.allow("@spam", now) {
		t.Fatal("one person must not fill the inbox")
	}
	sent := maxReportAlertsReporterDay
	for i := 0; sent < maxReportAlertsDay; i++ {
		if g.allow(fmt.Sprintf("@student%d", i), now) {
			sent++
		}
	}
	if g.allow("@someone.new", now) {
		t.Fatal("the daily cap must hold across everyone")
	}
	if !g.allow("@spam", now.Add(24*time.Hour)) {
		t.Fatal("a new day starts fresh")
	}
}
