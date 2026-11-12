package httpapi

import (
	"net/http"
	"regexp"
	"slices"
	"strings"
	"unicode"

	"csimap/bkapp/internal/email"
)

const maxUserAgent = 512

var countryCode = regexp.MustCompile(`^[A-Z]{2}$`)

// seenAt describes where a sign in came from, for the owner's alert. Nothing here is stored.
func (a *authHandlers) seenAt(r *http.Request) email.SignIn {
	return email.SignIn{
		Device:   describeDevice(r.UserAgent(), fromApp(r), a.appName),
		Location: visitorLocation(r.Header),
		IP:       a.clientIP(r),
	}
}

// describeDevice turns a user agent into words like "Chrome on Windows". Unknown agents give an empty string.
func describeDevice(agent string, app bool, appName string) string {
	if len(agent) > maxUserAgent {
		agent = agent[:maxUserAgent]
	}
	system := ""
	switch {
	case strings.Contains(agent, "iPhone"):
		system = "iPhone"
	case strings.Contains(agent, "iPad"):
		system = "iPad"
	case strings.Contains(agent, "Android"):
		system = "Android"
	case strings.Contains(agent, "CrOS"):
		system = "ChromeOS"
	case strings.Contains(agent, "Macintosh"), strings.Contains(agent, "Mac OS X"):
		system = "Mac"
	case strings.Contains(agent, "Windows"):
		system = "Windows"
	case strings.Contains(agent, "Linux"):
		system = "Linux"
	// The phone app's requests carry the network library's name instead of a browser's.
	case app && strings.Contains(agent, "Darwin"):
		system = "iPhone"
	case app && strings.Contains(agent, "okhttp"):
		system = "Android"
	}

	if app {
		if system == "" {
			return appName + " app"
		}
		return appName + " app on " + system
	}

	browser := ""
	switch {
	case strings.Contains(agent, "Edg/"), strings.Contains(agent, "EdgiOS"), strings.Contains(agent, "EdgA"):
		browser = "Edge"
	case strings.Contains(agent, "OPR/"), strings.Contains(agent, "Opera"):
		browser = "Opera"
	case strings.Contains(agent, "SamsungBrowser"):
		browser = "Samsung Internet"
	case strings.Contains(agent, "Firefox/"), strings.Contains(agent, "FxiOS"):
		browser = "Firefox"
	case strings.Contains(agent, "CriOS"), strings.Contains(agent, "Chrome/"):
		browser = "Chrome"
	case strings.Contains(agent, "Safari/"):
		browser = "Safari"
	}
	switch {
	case browser != "" && system != "":
		return browser + " on " + system
	case browser != "":
		return browser
	case system != "":
		return "A browser on " + system
	}
	return ""
}

// visitorLocation reads Cloudflare's visitor location headers. nginx clears them on requests that skipped Cloudflare,
// so a caller cannot pick the place shown in the alert.
func visitorLocation(h http.Header) string {
	var parts []string
	for _, name := range []string{"Cf-Ipcity", "Cf-Region"} {
		if value := placeName(h.Get(name)); value != "" && !slices.Contains(parts, value) {
			parts = append(parts, value)
		}
	}
	// XX is unknown and T1 is Tor; neither says where someone is.
	if country := strings.TrimSpace(h.Get("Cf-Ipcountry")); countryCode.MatchString(country) && country != "XX" && country != "T1" {
		parts = append(parts, country)
	}
	return strings.Join(parts, ", ")
}

// placeName keeps a header only if it reads like a place: letters, spaces and a little punctuation.
func placeName(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > 60 {
		return ""
	}
	for _, r := range value {
		if !unicode.IsLetter(r) && !unicode.IsMark(r) && !strings.ContainsRune(" .'-()", r) {
			return ""
		}
	}
	return value
}
