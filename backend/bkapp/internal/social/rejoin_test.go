package social_test

import (
	"context"
	"errors"
	"testing"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/social"
)

func befriend(t *testing.T, ctx context.Context, s *social.Service, a, b auth.User) {
	t.Helper()
	if _, err := s.SendRequest(ctx, a, b.Username); err != nil {
		t.Fatal(err)
	}
	if err := s.AcceptRequest(ctx, b, a.Username); err != nil {
		t.Fatal(err)
	}
}

func memberStatus(m social.Meetup, username string) (string, bool) {
	for _, member := range m.Members {
		if member.Username == username {
			return member.Status, member.StaysOut
		}
	}
	return "", false
}

// Leaving by mistake is undone by the host inviting you back into the same meetup, unless you said to stay out.
func TestInviteBackIntoTheSameMeetup(t *testing.T) {
	h, ctx := setup(t)
	s := h.social
	alice := h.person(t, ctx, "alice")
	bob := h.person(t, ctx, "bob")
	carol := h.person(t, ctx, "carol")
	befriend(t, ctx, s, alice, bob)
	befriend(t, ctx, s, alice, carol)

	m, err := s.CreateMeetup(ctx, alice, social.CreateMeetup{
		Friends:     []string{bob.Username},
		Destination: social.DestinationInput{Kind: social.DestinationMember, Username: alice.Username},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RespondToMeetup(ctx, bob, m.ID, true, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LeaveMeetup(ctx, bob, m.ID, false); err != nil {
		t.Fatal(err)
	}

	back, err := s.InviteToMeetup(ctx, alice, m.ID, []string{bob.Username, carol.Username})
	if err != nil {
		t.Fatalf("invite back: %v", err)
	}
	if status, _ := memberStatus(back, bob.Username); status != social.StatusInvited {
		t.Fatalf("bob should be invited again, got %q", status)
	}
	if status, _ := memberStatus(back, carol.Username); status != social.StatusInvited {
		t.Fatalf("carol should be newly invited, got %q", status)
	}
	if joined, err := s.RespondToMeetup(ctx, bob, m.ID, true, false); err != nil || joined.YourStatus != social.StatusJoined {
		t.Fatalf("rejoin: %+v %v", joined, err)
	}

	// Only the host invites.
	if _, err := s.InviteToMeetup(ctx, bob, m.ID, []string{carol.Username}); !errors.Is(err, social.ErrNotHost) {
		t.Fatalf("guest invited: %v", err)
	}

	// Leaving for good sticks.
	left, err := s.LeaveMeetup(ctx, bob, m.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if status, staysOut := memberStatus(left, bob.Username); status != social.StatusLeft || !staysOut {
		t.Fatalf("bob should have left for good: %q %v", status, staysOut)
	}
	var bad *social.InvalidError
	if _, err := s.InviteToMeetup(ctx, alice, m.ID, []string{bob.Username}); !errors.As(err, &bad) {
		t.Fatalf("invited someone who asked to stay out: %v", err)
	}

	// The database refuses it too, even when asked directly.
	var ok bool
	if err := h.pool.QueryRow(ctx, `select csimap_reinvite_member((select id from meetups where public_id = $1), $2::uuid)`,
		m.ID, bob.ID).Scan(&ok); err != nil || ok {
		t.Fatalf("reinvite without a signed in host must do nothing: %v %v", ok, err)
	}
}

// Someone in a meetup can still be invited to another at the same time, but has to leave the first to join.
func TestOneMeetupAtATime(t *testing.T) {
	h, ctx := setup(t)
	s := h.social
	alice := h.person(t, ctx, "alice")
	bob := h.person(t, ctx, "bob")
	carol := h.person(t, ctx, "carol")
	befriend(t, ctx, s, alice, bob)
	befriend(t, ctx, s, carol, bob)

	first, err := s.CreateMeetup(ctx, alice, social.CreateMeetup{
		Friends:     []string{bob.Username},
		Destination: social.DestinationInput{Kind: social.DestinationMember, Username: alice.Username},
		Minutes:     60,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RespondToMeetup(ctx, bob, first.ID, true, false); err != nil {
		t.Fatal(err)
	}

	second, err := s.CreateMeetup(ctx, carol, social.CreateMeetup{
		Friends:     []string{bob.Username},
		Destination: social.DestinationInput{Kind: social.DestinationMember, Username: carol.Username},
		Minutes:     60,
	})
	if err != nil {
		t.Fatalf("an invite should still go out: %v", err)
	}
	if _, err := s.RespondToMeetup(ctx, bob, second.ID, true, false); !errors.Is(err, social.ErrBusy) {
		t.Fatalf("joined two meetups at once: %v", err)
	}
	// Hosting a new one while in another is the same.
	if _, err := s.CreateMeetup(ctx, bob, social.CreateMeetup{
		Friends:     []string{alice.Username},
		Destination: social.DestinationInput{Kind: social.DestinationMember, Username: bob.Username},
	}); !errors.Is(err, social.ErrBusy) {
		t.Fatalf("hosted while in another meetup: %v", err)
	}

	if _, err := s.LeaveMeetup(ctx, bob, first.ID, false); err != nil {
		t.Fatal(err)
	}
	if joined, err := s.RespondToMeetup(ctx, bob, second.ID, true, false); err != nil || joined.YourStatus != social.StatusJoined {
		t.Fatalf("join after leaving the first: %+v %v", joined, err)
	}

	// A public event next week does not overlap a meetup now.
	later, err := s.CreatePublicMeetup(ctx, alice, social.NewPublicMeetup{
		Title:       "Study group",
		Destination: social.DestinationInput{Kind: social.DestinationPlace, PlaceID: h.site.Places[0].ID},
		StartsIn:    6 * 24 * 60,
		Minutes:     60,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.JoinPublicMeetup(ctx, bob, later.ID); err != nil {
		t.Fatalf("a later event should be fine: %v", err)
	}
}
