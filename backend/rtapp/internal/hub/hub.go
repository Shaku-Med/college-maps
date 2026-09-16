// Package hub fans live positions out to everyone in a meetup. Positions exist only in memory
// and disappear when a member leaves, goes quiet, or the process restarts.
package hub

import (
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"
)

var ErrFull = errors.New("capacity reached")

type Limits struct {
	Rooms            int
	MembersPerRoom   int
	StreamsPerRoom   int
	StreamsPerMember int
	MaxStreams       int
	PositionTTL      time.Duration
	SubscriberBuffer int
}

// Sized for a college on shared Wi-Fi: many students share one public IP, and a reconnect
// briefly overlaps the dying stream instead of taking a new slot forever.
var DefaultLimits = Limits{
	Rooms:            4000,
	MembersPerRoom:   64,
	StreamsPerRoom:   48,
	StreamsPerMember: 3,
	MaxStreams:       8000,
	PositionTTL:      2 * time.Minute,
	SubscriberBuffer: 16,
}

type Position struct {
	Member   string   `json:"member"`
	Name     string   `json:"name"`
	Lat      float64  `json:"lat"`
	Lng      float64  `json:"lng"`
	Accuracy float64  `json:"accuracy"`
	Heading  *float64 `json:"heading,omitempty"`
	At       int64    `json:"at"`
}

type Event struct {
	Type string
	Data []byte
}

type Subscription struct {
	events chan Event
	room   string
	member string
	joined time.Time
	closed bool
}

// Events closes when the hub drops the stream, for example when the client reads too slowly.
func (s *Subscription) Events() <-chan Event {
	return s.events
}

type room struct {
	positions map[string]Position
	subs      map[*Subscription]struct{}
}

type Hub struct {
	mu          sync.Mutex
	rooms       map[string]*room
	limits      Limits
	streamCount int
	now         func() time.Time
}

func New(limits Limits) *Hub {
	return &Hub{rooms: map[string]*room{}, limits: limits, now: time.Now}
}

func (h *Hub) roomFor(id string) (*room, error) {
	if r, ok := h.rooms[id]; ok {
		return r, nil
	}
	if len(h.rooms) >= h.limits.Rooms {
		return nil, ErrFull
	}
	r := &room{positions: map[string]Position{}, subs: map[*Subscription]struct{}{}}
	h.rooms[id] = r
	return r, nil
}

func (h *Hub) Subscribe(roomID, member string) (*Subscription, []Position, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	r, err := h.roomFor(roomID)
	if err != nil {
		return nil, nil, err
	}

	var oldest *Subscription
	mine := 0
	for s := range r.subs {
		if s.member != member {
			continue
		}
		mine++
		if oldest == nil || s.joined.Before(oldest.joined) {
			oldest = s
		}
	}

	// A reconnecting phone keeps the new stream. The idle one is dropped so flaky campus Wi-Fi
	// does not fill the room with ghosts and then refuse the person who is actually here.
	if mine >= h.limits.StreamsPerMember && oldest != nil {
		h.closeSub(r, oldest)
	}

	if len(r.subs) >= h.limits.StreamsPerRoom || h.streamCount >= h.limits.MaxStreams {
		h.dropIfEmpty(roomID, r)
		return nil, nil, ErrFull
	}

	sub := &Subscription{
		events: make(chan Event, h.limits.SubscriberBuffer),
		room:   roomID,
		member: member,
		joined: h.now(),
	}
	r.subs[sub] = struct{}{}
	h.streamCount++

	snapshot := make([]Position, 0, len(r.positions))
	for _, p := range r.positions {
		snapshot = append(snapshot, p)
	}
	sort.Slice(snapshot, func(i, j int) bool { return snapshot[i].Member < snapshot[j].Member })
	return sub, snapshot, nil
}

func (h *Hub) Unsubscribe(sub *Subscription) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.rooms[sub.room]; ok {
		h.closeSub(r, sub)
		h.dropIfEmpty(sub.room, r)
	}
}

func (h *Hub) Publish(roomID string, p Position) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	r, err := h.roomFor(roomID)
	if err != nil {
		return err
	}
	if _, known := r.positions[p.Member]; !known && len(r.positions) >= h.limits.MembersPerRoom {
		h.dropIfEmpty(roomID, r)
		return ErrFull
	}
	p.At = h.now().UnixMilli()
	r.positions[p.Member] = p
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	h.broadcast(r, Event{Type: "position", Data: data})
	return nil
}

func (h *Hub) Leave(roomID, member string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[roomID]
	if !ok {
		return
	}
	h.removePosition(r, member)
	h.dropIfEmpty(roomID, r)
}

// Sweep forgets positions nobody has refreshed, so a closed tab stops showing on friends' maps.
func (h *Hub) Sweep() {
	h.mu.Lock()
	defer h.mu.Unlock()
	cutoff := h.now().Add(-h.limits.PositionTTL).UnixMilli()
	for id, r := range h.rooms {
		for member, p := range r.positions {
			if p.At <= cutoff {
				h.removePosition(r, member)
			}
		}
		h.dropIfEmpty(id, r)
	}
}

func (h *Hub) Run(stop <-chan struct{}) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			h.Sweep()
		case <-stop:
			return
		}
	}
}

func (h *Hub) removePosition(r *room, member string) {
	if _, ok := r.positions[member]; !ok {
		return
	}
	delete(r.positions, member)
	data, _ := json.Marshal(map[string]string{"member": member})
	h.broadcast(r, Event{Type: "leave", Data: data})
}

// broadcast never blocks. A stream that falls behind is closed and reconnects to a fresh snapshot.
func (h *Hub) broadcast(r *room, e Event) {
	for sub := range r.subs {
		select {
		case sub.events <- e:
		default:
			h.closeSub(r, sub)
		}
	}
}

func (h *Hub) closeSub(r *room, sub *Subscription) {
	if sub.closed {
		return
	}
	sub.closed = true
	delete(r.subs, sub)
	if h.streamCount > 0 {
		h.streamCount--
	}
	close(sub.events)
}

func (h *Hub) dropIfEmpty(id string, r *room) {
	if len(r.subs) == 0 && len(r.positions) == 0 {
		delete(h.rooms, id)
	}
}
