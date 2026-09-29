package push

import "testing"

func TestNormalizeSubscription(t *testing.T) {
	for _, endpoint := range []string{
		"https://fcm.googleapis.com/fcm/send/abc",
		"https://updates.push.services.mozilla.com/wpush/v2/abc",
		"https://web.push.apple.com/QOabc",
		"https://wns2-bn3p.notify.windows.com/w/?token=abc",
	} {
		if _, _, _, err := normalizeSubscription(endpoint, "abcdefghijklmnopqrst", "abcdefgh", false); err != nil {
			t.Errorf("refused a real push service %q: %v", endpoint, err)
		}
	}
	cases := []struct{ endpoint, p256dh, auth string }{
		{"", "abcdefghijklmnopqrst", "abcdefgh"},
		{"http://evil.example/push", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://evil.example/push", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://fcm.googleapis.com.evil.example/x", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://evilfcm.googleapis.com/x", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://notify.windows.com/x", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://evil.notify.windows.com.example/x", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://fcm.googleapis.com:8443/x", "abcdefghijklmnopqrst", "abcdefgh"},
		{"http://localhost:8080/push", "abcdefghijklmnopqrst", "abcdefgh"},
		{"http://127.0.0.1/push", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://169.254.169.254/latest", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://user:pass@fcm.googleapis.com/x", "abcdefghijklmnopqrst", "abcdefgh"},
		{"https://fcm.googleapis.com/x", "short", "abcdefgh"},
		{"https://fcm.googleapis.com/x", "abcdefghijklmnopqrst", "xx"},
	}
	for _, tc := range cases {
		if _, _, _, err := normalizeSubscription(tc.endpoint, tc.p256dh, tc.auth, false); err == nil {
			t.Errorf("accepted %q in production", tc.endpoint)
		}
	}
	// A local push server only works during development.
	if _, _, _, err := normalizeSubscription("http://localhost:8080/push", "abcdefghijklmnopqrst", "abcdefgh", true); err != nil {
		t.Errorf("refused a local push server in development: %v", err)
	}
}
