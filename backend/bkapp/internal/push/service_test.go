package push

import "testing"

func TestNormalizeSubscription(t *testing.T) {
	_, _, _, err := normalizeSubscription("https://fcm.googleapis.com/fcm/send/abc", "abcdefghijklmnopqrst", "abcdefgh")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct{ endpoint, p256dh, auth string }{
		{"", "abcdefghijklmnopqrst", "abcdefgh"},
		{"http://evil.example/push", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://user:pass@fcm.googleapis.com/x", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://fcm.googleapis.com/x", "short", "abcdefgh"},
		{"https://fcm.googleapis.com/x", "abcdefghijklmnopqrst", "xx"},
	}
	for _, tc := range cases {
		if _, _, _, err := normalizeSubscription(tc.endpoint, tc.p256dh, tc.auth); err == nil {
			t.Fatalf("accepted %q", tc.endpoint)
		}
	}
}
