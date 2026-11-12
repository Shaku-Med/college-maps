package push

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestServiceNameHidesTheEndpoint(t *testing.T) {
	cases := map[string]string{
		"https://fcm.googleapis.com/fcm/send/abc123secret":          "Chrome, Android and other Chromium browsers",
		"https://updates.push.services.mozilla.com/wpush/v2/secret": "Firefox",
		"https://web.push.apple.com/QGuQyavXutnMH8hcIsl0Vvt4secret": "Safari or an iPhone home screen app",
		"https://wns2-bl2p.notify.windows.com/w/?token=secret":      "Edge or another Windows browser",
		"http://localhost/push/secret":                              "Local development",
		"https://example.com/secret":                                "Unknown",
	}
	for endpoint, want := range cases {
		got := serviceName(endpoint)
		if got != want {
			t.Errorf("serviceName(%q) = %q, want %q", endpoint, got, want)
		}
		if strings.Contains(got, "secret") {
			t.Errorf("serviceName(%q) leaked the address", endpoint)
		}
	}
}

func TestSubscriptionUsesTheExportKeys(t *testing.T) {
	out, err := json.Marshal(Subscription{Service: "Firefox", CreatedAt: "2026-11-12T02:05:39Z"})
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"service":"Firefox","createdAt":"2026-11-12T02:05:39Z"}`; string(out) != want {
		t.Fatalf("got %s, want %s", out, want)
	}
}
