package hub

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func newTestHub(limits Limits) (*Hub, *time.Time) {
	now := time.Unix(1_800_000_000, 0)
	h := New(limits)
	h.now = func() time.Time { return now }
	return h, &now
}

func pos(member string) Position {
	return Position{Member: member, Name: member, Lat: 40.6, Lng: -74.15, Accuracy: 10}
}

func next(t *testing.T, sub *Subscription) Event {
	t.Helper()
	select {
	case e, ok := <-sub.Events():
		if !ok {
			t.Fatal("subscription closed")
		}
		return e
	default:
		t.Fatal("expected an event")
		return Event{}
	}
}

func TestSnapshotPublishAndLeave(t *testing.T) {
	h, _ := newTestHub(DefaultLimits)
	if err := h.Publish("room-one", pos("alice")); err != nil {
		t.Fatal(err)
	}

	sub, snapshot, err := h.Subscribe("room-one", "bob")
	if err != nil || len(snapshot) != 1 || snapshot[0].Member != "alice" {
		t.Fatalf("snapshot %v %v", snapshot, err)
	}

	_ = h.Publish("room-two", pos("carol"))
	_ = h.Publish("room-one", pos("dave"))
	e := next(t, sub)
	var got Position
	if e.Type != "position" || json.Unmarshal(e.Data, &got) != nil || got.Member != "dave" {
		t.Fatalf("event %s %s", e.Type, e.Data)
	}

	h.Leave("room-one", "dave")
	if e := next(t, sub); e.Type != "leave" || string(e.Data) != `{"member":"dave"}` {
		t.Fatalf("leave event %s %s", e.Type, e.Data)
	}

	h.Unsubscribe(sub)
	h.Unsubscribe(sub)
	if _, ok := <-sub.Events(); ok {
		t.Fatal("unsubscribe should close events")
	}
}

func TestSweepForgetsQuietMembers(t *testing.T) {
	h, now := newTestHub(DefaultLimits)
	_ = h.Publish("room-one", pos("alice"))
	sub, _, _ := h.Subscribe("room-one", "bob")

	*now = now.Add(DefaultLimits.PositionTTL + time.Second)
	h.Sweep()
	if e := next(t, sub); e.Type != "leave" {
		t.Fatalf("expected leave, got %s", e.Type)
	}

	h.Unsubscribe(sub)
	if len(h.rooms) != 0 {
		t.Fatal("empty rooms should be removed")
	}
}

func TestLimits(t *testing.T) {
	limits := DefaultLimits
	limits.Rooms = 1
	limits.MembersPerRoom = 1
	limits.StreamsPerMember = 1
	limits.SubscriberBuffer = 1
	h, _ := newTestHub(limits)

	_ = h.Publish("room-one", pos("alice"))
	if err := h.Publish("room-one", pos("bob")); !errors.Is(err, ErrFull) {
		t.Fatal("members per room should be capped")
	}
	if err := h.Publish("room-two", pos("carol")); !errors.Is(err, ErrFull) {
		t.Fatal("rooms should be capped")
	}

	sub, _, err := h.Subscribe("room-one", "alice")
	if err != nil {
		t.Fatal(err)
	}
	replaced, _, err := h.Subscribe("room-one", "alice")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := <-sub.Events(); ok {
		t.Fatal("a reconnect should replace the older stream for the same member")
	}

	_ = h.Publish("room-one", pos("alice"))
	_ = h.Publish("room-one", pos("alice"))
	<-replaced.Events()
	if _, ok := <-replaced.Events(); ok {
		t.Fatal("a slow stream should be dropped instead of blocking the room")
	}
}

func TestMaxStreams(t *testing.T) {
	limits := DefaultLimits
	limits.MaxStreams = 1
	h, _ := newTestHub(limits)

	if _, _, err := h.Subscribe("room-one", "alice"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.Subscribe("room-two", "bob"); !errors.Is(err, ErrFull) {
		t.Fatal("total streams should be capped")
	}
}
