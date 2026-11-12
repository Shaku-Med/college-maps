package auth

import (
	"testing"
	"time"
)

func TestMailBudgetKeepsRoomForCodes(t *testing.T) {
	var b mailBudget
	day := time.Date(2026, 11, 11, 23, 0, 0, 0, time.UTC)
	for i := 0; i < dailyOptionalMail; i++ {
		if !b.take(dailyOptionalMail, day) {
			t.Fatalf("alert %d refused early", i)
		}
	}
	if b.take(dailyOptionalMail, day) {
		t.Fatal("alerts must stop at their share")
	}
	for i := dailyOptionalMail; i < dailyMailLimit; i++ {
		if !b.take(dailyMailLimit, day) {
			t.Fatalf("code %d refused while under the limit", i)
		}
	}
	if b.take(dailyMailLimit, day) {
		t.Fatal("codes must stop at the daily limit")
	}
	if !b.take(dailyOptionalMail, day.Add(2*time.Hour)) {
		t.Fatal("a new UTC day must start a fresh count")
	}
}
