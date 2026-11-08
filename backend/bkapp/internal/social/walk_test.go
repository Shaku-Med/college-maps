package social_test

import (
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"csimap/bkapp/internal/social"
	"csimap/bkapp/internal/ticket"
)

type sentPing struct {
	to   []string
	body string
}

// Sharing a walk: a few friends watch the walker until they arrive, and nobody watching can share or take over.
func TestWalkShares(t *testing.T) {
	h, ctx := setup(t)
	s := h.social
	var mu sync.Mutex
	var pings []sentPing
	s.SetNotify(func(_, _ string, userIDs []string, _, body, _ string) {
		mu.Lock()
		defer mu.Unlock()
		pings = append(pings, sentPing{to: slices.Clone(userIDs), body: body})
	})
	lastPing := func() sentPing {
		mu.Lock()
		defer mu.Unlock()
		if len(pings) == 0 {
			return sentPing{}
		}
		return pings[len(pings)-1]
	}

	ana := h.person(t, ctx, "ana")
	sam := h.person(t, ctx, "sam")
	lee := h.person(t, ctx, "lee")
	kim := h.person(t, ctx, "kim")
	joe := h.person(t, ctx, "joe")
	stranger := h.person(t, ctx, "stranger")
	befriend(t, ctx, s, ana, sam)
	befriend(t, ctx, s, ana, lee)
	befriend(t, ctx, s, ana, kim)
	befriend(t, ctx, s, ana, joe)
	befriend(t, ctx, s, sam, lee)

	placeID := h.site.Places[0].ID
	toPlace := social.DestinationInput{Kind: social.DestinationPlace, PlaceID: placeID}

	for name, in := range map[string]social.CreateMeetup{
		"too many":    {Kind: social.KindWalk, Friends: []string{sam.Username, lee.Username, kim.Username, joe.Username}, Destination: toPlace, Minutes: 20},
		"to a person": {Kind: social.KindWalk, Friends: []string{sam.Username}, Destination: social.DestinationInput{Kind: social.DestinationMember, Username: sam.Username}, Minutes: 20},
		"far pin":     {Kind: social.KindWalk, Friends: []string{sam.Username}, Destination: social.DestinationInput{Kind: social.DestinationPin, Lat: ptr(40.7128), Lng: ptr(-74.0060)}, Minutes: 20},
		"not friends": {Kind: social.KindWalk, Friends: []string{stranger.Username}, Destination: toPlace, Minutes: 20},
		"odd kind":    {Kind: "party", Friends: []string{sam.Username}, Destination: toPlace, Minutes: 20},
		"too long":    {Kind: social.KindWalk, Friends: []string{sam.Username}, Destination: toPlace, Minutes: 600},
	} {
		var bad *social.InvalidError
		if _, err := s.CreateMeetup(ctx, ana, in); !errors.As(err, &bad) {
			t.Errorf("%s: expected a validation error, got %v", name, err)
		}
	}

	// Sam is already in a meetup with Lee, and watching a walk still fits.
	busy, err := s.CreateMeetup(ctx, sam, social.CreateMeetup{
		Friends:     []string{lee.Username},
		Destination: social.DestinationInput{Kind: social.DestinationMember, Username: sam.Username},
	})
	if err != nil || busy.Kind != social.KindMeetup {
		t.Fatalf("plain meetup: %+v %v", busy, err)
	}

	walk, err := s.CreateMeetup(ctx, ana, social.CreateMeetup{Kind: social.KindWalk, Friends: []string{sam.Username, lee.Username}, Destination: toPlace, Minutes: 25})
	if err != nil || walk.Kind != social.KindWalk || !walk.Active || walk.YourRole != "host" || len(walk.Members) != 3 {
		t.Fatalf("walk: %+v %v", walk, err)
	}
	if got := lastPing(); !strings.Contains(got.body, "is sharing their walk") || len(got.to) != 2 || strings.Contains(got.body, placeID) {
		t.Fatalf("walk ping: %+v", got)
	}

	if _, err := s.GetMeetup(ctx, stranger, walk.ID); !errors.Is(err, social.ErrMeetupNotFound) {
		t.Fatalf("a stranger saw the walk: %v", err)
	}
	if invite, err := s.GetMeetup(ctx, sam, walk.ID); err != nil || invite.Destination != nil {
		t.Fatalf("an unanswered walk should hide where it goes: %+v %v", invite, err)
	}

	watching, err := s.RespondToMeetup(ctx, sam, walk.ID, true, false)
	if err != nil || watching.YourStatus != social.StatusJoined || watching.Destination == nil {
		t.Fatalf("watch while in a meetup: %+v %v", watching, err)
	}
	// Watching never blocks joining a real meetup either.
	if _, err := s.RespondToMeetup(ctx, lee, busy.ID, true, false); err != nil {
		t.Fatalf("lee joins sam's meetup: %v", err)
	}
	if _, err := s.RespondToMeetup(ctx, lee, walk.ID, true, false); err != nil {
		t.Fatalf("lee watches while in a meetup: %v", err)
	}

	pass, err := s.LiveTicket(ctx, sam, walk.ID)
	if err != nil {
		t.Fatal(err)
	}
	if claims, err := ticket.Verify(ticketSecret, pass.Token, time.Now()); err != nil || !claims.Watch {
		t.Fatalf("a watcher's pass must be watch only: %+v %v", claims, err)
	}
	pass, err = s.LiveTicket(ctx, ana, walk.ID)
	if err != nil {
		t.Fatal(err)
	}
	if claims, err := ticket.Verify(ticketSecret, pass.Token, time.Now()); err != nil || claims.Watch {
		t.Fatalf("the walker's pass must share: %+v %v", claims, err)
	}
	pass, err = s.LiveTicket(ctx, sam, busy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if claims, err := ticket.Verify(ticketSecret, pass.Token, time.Now()); err != nil || claims.Watch {
		t.Fatalf("a meetup pass must share: %+v %v", claims, err)
	}

	var bad *social.InvalidError
	if _, err := s.InviteToMeetup(ctx, ana, walk.ID, []string{kim.Username}); !errors.As(err, &bad) {
		t.Fatalf("adding watchers mid walk: %v", err)
	}
	if _, err := s.EndMeetup(ctx, sam, walk.ID, true); !errors.Is(err, social.ErrNotHost) {
		t.Fatalf("a watcher ended the walk: %v", err)
	}

	// A second walk ends the first, so there is only ever one.
	next, err := s.CreateMeetup(ctx, ana, social.CreateMeetup{Kind: social.KindWalk, Friends: []string{kim.Username, joe.Username}, Destination: toPlace, Minutes: 15})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RespondToMeetup(ctx, kim, next.ID, true, false); err != nil {
		t.Fatal(err)
	}
	if first, err := s.GetMeetup(ctx, ana, walk.ID); err != nil || first.Active {
		t.Fatalf("the first walk should be over: %+v %v", first, err)
	}
	if _, err := s.LiveTicket(ctx, sam, walk.ID); !errors.Is(err, social.ErrMeetupOver) {
		t.Fatalf("watching an ended walk: %v", err)
	}

	ended, err := s.EndMeetup(ctx, ana, next.ID, true)
	if err != nil || ended.Active {
		t.Fatalf("end walk: %+v %v", ended, err)
	}
	// Kim watched, so Kim hears where; Joe never opened it, so the place stays hidden from Joe.
	mu.Lock()
	arrival := slices.Clone(pings[len(pings)-2:])
	mu.Unlock()
	if want := "Ana made it to " + h.site.Places[0].Name; arrival[0].body != want || !slices.Equal(arrival[0].to, []string{kim.ID}) {
		t.Fatalf("watcher arrival ping: %+v, want %q to kim", arrival[0], want)
	}
	if arrival[1].body != "Ana made it" || !slices.Equal(arrival[1].to, []string{joe.ID}) {
		t.Fatalf("unopened arrival ping: %+v", arrival[1])
	}

	// Ending again sends nothing new.
	mu.Lock()
	before := len(pings)
	mu.Unlock()
	if _, err := s.EndMeetup(ctx, ana, next.ID, true); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	after := len(pings)
	mu.Unlock()
	if after != before {
		t.Fatal("ending an ended walk pinged again")
	}
}
