package httpapi

import (
	"net/http"
	"testing"
)

func TestDescribeDevice(t *testing.T) {
	cases := []struct {
		agent string
		app   bool
		want  string
	}{
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", false, "Chrome on Windows"},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", false, "Edge on Windows"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", false, "Safari on iPhone"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1", false, "Chrome on iPhone"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", false, "Safari on Mac"},
		{"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", false, "Chrome on Android"},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", false, "Firefox on Linux"},
		{"CSIMap/3 CFNetwork/1568.200.51 Darwin/24.1.0", true, "CSI Map app on iPhone"},
		{"okhttp/4.12.0", true, "CSI Map app on Android"},
		{"", true, "CSI Map app"},
		{"curl/8.4.0", false, ""},
	}
	for _, c := range cases {
		if got := describeDevice(c.agent, c.app, "CSI Map"); got != c.want {
			t.Errorf("describeDevice(%q, %v) = %q, want %q", c.agent, c.app, got, c.want)
		}
	}
}

func TestVisitorLocation(t *testing.T) {
	header := func(pairs ...string) http.Header {
		h := http.Header{}
		for i := 0; i < len(pairs); i += 2 {
			h.Set(pairs[i], pairs[i+1])
		}
		return h
	}
	cases := map[string]struct {
		h    http.Header
		want string
	}{
		"full":            {header("Cf-Ipcity", "Staten Island", "Cf-Region", "New York", "Cf-Ipcountry", "US"), "Staten Island, New York, US"},
		"accents":         {header("Cf-Ipcity", "São Paulo", "Cf-Ipcountry", "BR"), "São Paulo, BR"},
		"same city name":  {header("Cf-Ipcity", "New York", "Cf-Region", "New York", "Cf-Ipcountry", "US"), "New York, US"},
		"country only":    {header("Cf-Ipcountry", "US"), "US"},
		"unknown country": {header("Cf-Ipcountry", "XX"), ""},
		"tor":             {header("Cf-Ipcountry", "T1"), ""},
		"markup dropped":  {header("Cf-Ipcity", "<b>Home</b>", "Cf-Ipcountry", "US"), "US"},
		"encoded dropped": {header("Cf-Ipcity", "S%C3%A3o", "Cf-Ipcountry", "BR"), "BR"},
		"bad country":     {header("Cf-Ipcountry", "usa"), ""},
		"nothing":         {header(), ""},
	}
	for name, c := range cases {
		if got := visitorLocation(c.h); got != c.want {
			t.Errorf("%s: got %q, want %q", name, got, c.want)
		}
	}
}
