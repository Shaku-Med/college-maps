package server

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"csimap/rtapp/internal/config"
	"csimap/rtapp/internal/hub"
	"csimap/rtapp/internal/ticket"
)

const appOrigin = "http://localhost:3000"

var secret = []byte(strings.Repeat("t", 40))

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	cfg := config.Config{Port: 8090, Env: "development", AllowedOrigins: map[string]struct{}{appOrigin: {}}, TicketSecret: secret}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := httptest.NewUnstartedServer(New(cfg, logger, hub.New(hub.DefaultLimits)).Handler())
	srv.Config.ReadTimeout = 300 * time.Millisecond
	srv.Start()
	t.Cleanup(srv.Close)
	return srv
}

func sign(t *testing.T, room, member, name string) string {
	t.Helper()
	token, err := ticket.Sign(secret, ticket.Claims{Room: room, Member: member, Name: name, Expires: time.Now().Add(10 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func post(t *testing.T, srv *httptest.Server, path, token, body string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+path, strings.NewReader(body))
	req.Header.Set("Origin", appOrigin)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res
}

type sseEvent struct {
	name string
	data string
}

func openStream(t *testing.T, srv *httptest.Server, token string) (<-chan sseEvent, func()) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/v1/stream?ticket="+url.QueryEscape(token), nil)
	req.Header.Set("Origin", appOrigin)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("stream status %d", res.StatusCode)
	}

	events := make(chan sseEvent, 16)
	go func() {
		defer close(events)
		scanner := bufio.NewScanner(res.Body)
		var current sseEvent
		for scanner.Scan() {
			line := scanner.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				current.name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				current.data = strings.TrimPrefix(line, "data: ")
			case line == "" && current.name != "":
				events <- current
				current = sseEvent{}
			}
		}
	}()
	return events, func() { res.Body.Close() }
}

func expectEvent(t *testing.T, events <-chan sseEvent, name string) sseEvent {
	t.Helper()
	select {
	case e, ok := <-events:
		if !ok || e.name != name {
			t.Fatalf("got %+v (open %v), want %s", e, ok, name)
		}
		return e
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", name)
		return sseEvent{}
	}
}

func TestStreamReceivesPositionsAndLeaves(t *testing.T) {
	srv := newTestServer(t)
	alice := sign(t, "meetup_room01", "member_alice1", "Alice")
	bob := sign(t, "meetup_room01", "member_bob001", "Bob")
	stranger := sign(t, "meetup_room02", "member_carol1", "Carol")

	events, closeStream := openStream(t, srv, alice)
	defer closeStream()
	snapshot := expectEvent(t, events, "snapshot")
	if snapshot.data != `{"positions":[],"you":"member_alice1"}` {
		t.Fatalf("snapshot %s", snapshot.data)
	}

	if res := post(t, srv, "/v1/position", stranger, `{"lat":40.6,"lng":-74.15,"accuracy":8}`); res.StatusCode != http.StatusNoContent {
		t.Fatalf("stranger post %d", res.StatusCode)
	}

	// Waiting past the server read timeout proves streams survive it.
	time.Sleep(400 * time.Millisecond)

	if res := post(t, srv, "/v1/position", bob, `{"lat":40.60214567,"lng":-74.1502,"accuracy":12.4,"heading":90}`); res.StatusCode != http.StatusNoContent {
		t.Fatalf("bob post %d", res.StatusCode)
	}
	e := expectEvent(t, events, "position")
	var p hub.Position
	if err := json.Unmarshal([]byte(e.data), &p); err != nil {
		t.Fatal(err)
	}
	if p.Member != "member_bob001" || p.Name != "Bob" || p.Lat != 40.602146 || p.Accuracy != 12 || p.Heading == nil || *p.Heading != 90 {
		t.Fatalf("position %+v", p)
	}

	if res := post(t, srv, "/v1/leave", bob, ""); res.StatusCode != http.StatusNoContent {
		t.Fatalf("leave %d", res.StatusCode)
	}
	if e := expectEvent(t, events, "leave"); e.data != `{"member":"member_bob001"}` {
		t.Fatalf("leave %s", e.data)
	}
}

func TestRejectsBadTicketsOriginsAndBodies(t *testing.T) {
	srv := newTestServer(t)
	token := sign(t, "meetup_room01", "member_alice1", "Alice")
	good := `{"lat":40.6,"lng":-74.15,"accuracy":8}`

	if res := post(t, srv, "/v1/position", "", good); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("missing ticket %d", res.StatusCode)
	}
	if res := post(t, srv, "/v1/position", token+"x", good); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("tampered ticket %d", res.StatusCode)
	}

	for _, body := range []string{
		`{"lat":91,"lng":0,"accuracy":5}`,
		`{"lat":40,"lng":-181,"accuracy":5}`,
		`{"lat":40,"lng":-74}`,
		`{"lat":40,"lng":-74,"accuracy":-1}`,
		`{"lat":40,"lng":-74,"accuracy":5,"heading":360}`,
		`{"lat":40,"lng":-74,"accuracy":5,"name":"Mallory"}`,
		`{"lat":"40","lng":-74,"accuracy":5}`,
		`{"lat":40,"lng":-74,"accuracy":5}{}`,
		`{"lat":40,"lng":-74,"accuracy":5,"pad":"` + strings.Repeat("a", 2000) + `"}`,
	} {
		if res := post(t, srv, "/v1/position", token, body); res.StatusCode != http.StatusBadRequest {
			t.Errorf("body %.40s: status %d", body, res.StatusCode)
		}
	}

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/position", strings.NewReader(good))
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != http.StatusForbidden {
		t.Errorf("foreign origin %d", res.StatusCode)
	}

	streamReq, _ := http.NewRequest(http.MethodGet, srv.URL+"/v1/stream?ticket="+url.QueryEscape(token), nil)
	if res, _ := http.DefaultClient.Do(streamReq); res.StatusCode != http.StatusForbidden {
		t.Errorf("stream without origin %d", res.StatusCode)
	}
	streamReq.Header.Set("Origin", appOrigin)
	streamReq.URL.RawQuery = "ticket=nope"
	if res, _ := http.DefaultClient.Do(streamReq); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("stream with bad ticket %d", res.StatusCode)
	}
}

func TestPositionRateLimit(t *testing.T) {
	srv := newTestServer(t)
	token := sign(t, "meetup_room01", "member_alice1", "Alice")
	limited := false
	for i := 0; i < 45; i++ {
		if post(t, srv, "/v1/position", token, `{"lat":40.6,"lng":-74.15,"accuracy":8}`).StatusCode == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("rapid position posts should be limited")
	}
}

func TestSharedIPAllowsAClassOfStreams(t *testing.T) {
	srv := newTestServer(t)
	var closers []func()
	t.Cleanup(func() {
		for _, closeStream := range closers {
			closeStream()
		}
	})
	for i := 0; i < 12; i++ {
		token := sign(t, "meetup_room01", fmt.Sprintf("member_u%06d", i), "Ada")
		_, closeStream := openStream(t, srv, token)
		closers = append(closers, closeStream)
	}
}
