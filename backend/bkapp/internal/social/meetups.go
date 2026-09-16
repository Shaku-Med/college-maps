package social

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"csimap/bkapp/internal/auth"
	"csimap/bkapp/internal/db"
	"csimap/bkapp/internal/ticket"
)

const (
	MaxGuests            = 5
	minMeetupMinutes     = 15
	maxMeetupMinutes     = 240
	defaultMeetupMinutes = 120
	maxMeetupsPerDay     = 20
	maxActiveHosted      = 3
	maxNoteRunes         = 80
	ticketTTL            = 10 * time.Minute

	DestinationMember = "member"
	DestinationPlace  = "place"
	DestinationPin    = "pin"

	VisibilityPrivate = "private"
	VisibilityPublic  = "public"

	StatusInvited  = "invited"
	StatusJoined   = "joined"
	StatusDeclined = "declined"
	StatusLeft     = "left"
)

var (
	collapseSpace = regexp.MustCompile(`\s+`)
	publicIDRe    = regexp.MustCompile(`^[A-Za-z0-9_-]{16}$`)
)

type DestinationInput struct {
	Kind     string   `json:"kind"`
	Username string   `json:"username,omitempty"`
	PlaceID  string   `json:"placeId,omitempty"`
	Lat      *float64 `json:"lat,omitempty"`
	Lng      *float64 `json:"lng,omitempty"`
}

type CreateMeetup struct {
	Friends     []string         `json:"friends"`
	Destination DestinationInput `json:"destination"`
	Note        string           `json:"note"`
	Minutes     int              `json:"minutes"`
}

// Destination is only included for members who joined, so an invite alone never reveals a place.
type Destination struct {
	Kind     string   `json:"kind"`
	Username string   `json:"username,omitempty"`
	LiveID   string   `json:"liveId,omitempty"`
	PlaceID  string   `json:"placeId,omitempty"`
	Lat      *float64 `json:"lat,omitempty"`
	Lng      *float64 `json:"lng,omitempty"`
}

type Member struct {
	Person
	Role   string `json:"role"`
	Status string `json:"status"`
	LiveID string `json:"liveId,omitempty"`
}

type Meetup struct {
	ID          string       `json:"id"`
	Visibility  string       `json:"visibility"`
	Title       string       `json:"title,omitempty"`
	StartsAt    *time.Time   `json:"startsAt,omitempty"`
	Going       int          `json:"going"`
	Note        string       `json:"note"`
	Host        Person       `json:"host"`
	Destination *Destination `json:"destination,omitempty"`
	Members     []Member     `json:"members"`
	YourRole    string       `json:"yourRole"`
	YourStatus  string       `json:"yourStatus"`
	YourLiveID  string       `json:"yourLiveId,omitempty"`
	CreatedAt   time.Time    `json:"createdAt"`
	ExpiresAt   time.Time    `json:"expiresAt"`
	Active      bool         `json:"active"`
}

type Ticket struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func cleanNote(raw string) (string, error) {
	note := collapseSpace.ReplaceAllString(strings.TrimSpace(raw), " ")
	if utf8.RuneCountInString(note) > maxNoteRunes {
		return "", invalid("Keep the note under %d characters.", maxNoteRunes)
	}
	for _, r := range note {
		if r < 0x20 || r == 0x7f {
			return "", invalid("The note has characters that are not allowed.")
		}
	}
	return note, nil
}

func (s *Service) validateCreate(me auth.User, in CreateMeetup) (guests []string, note string, minutes int, err error) {
	if len(in.Friends) == 0 || len(in.Friends) > MaxGuests {
		return nil, "", 0, invalid("Invite between 1 and %d friends.", MaxGuests)
	}
	seen := map[string]bool{}
	for _, raw := range in.Friends {
		handle, ok := normalizeUsername(raw)
		if !ok || handle == me.Username {
			return nil, "", 0, invalid("One of the invited usernames is not valid.")
		}
		if !seen[handle] {
			seen[handle] = true
			guests = append(guests, handle)
		}
	}

	if note, err = cleanNote(in.Note); err != nil {
		return nil, "", 0, err
	}

	minutes = in.Minutes
	if minutes == 0 {
		minutes = defaultMeetupMinutes
	}
	if minutes < minMeetupMinutes || minutes > maxMeetupMinutes {
		return nil, "", 0, invalid("Meetups last between %d minutes and %d hours.", minMeetupMinutes, maxMeetupMinutes/60)
	}

	d := in.Destination
	switch d.Kind {
	case DestinationMember:
		handle, ok := normalizeUsername(d.Username)
		if !ok || (handle != me.Username && !seen[handle]) {
			return nil, "", 0, invalid("Pick yourself or one of the invited friends as the person to meet.")
		}
	case DestinationPlace:
		found := false
		for _, p := range s.site.Places {
			if p.ID == strings.ToUpper(d.PlaceID) {
				found = true
				break
			}
		}
		if !found {
			return nil, "", 0, invalid("That place is not on the campus map.")
		}
	case DestinationPin:
		if d.Lat == nil || d.Lng == nil || !s.site.WalkingArea.Contains(*d.Lat, *d.Lng) {
			return nil, "", 0, invalid("Drop the pin somewhere on campus.")
		}
	default:
		return nil, "", 0, invalid("Choose where to meet: a person, a place, or a pin.")
	}
	return guests, note, minutes, nil
}

func (s *Service) CreateMeetup(ctx context.Context, me auth.User, in CreateMeetup) (Meetup, error) {
	if err := ready(me); err != nil {
		return Meetup{}, err
	}
	guests, note, minutes, err := s.validateCreate(me, in)
	if err != nil {
		return Meetup{}, err
	}
	publicID, err := s.publicID()
	if err != nil {
		return Meetup{}, err
	}

	now := s.now()
	var created Meetup
	var invited []string
	err = db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		var today, active int
		if err := tx.QueryRow(ctx,
			`select
			   (select count(*) from meetups where host_id = $1::uuid and created_at > $2),
			   (select count(*) from meetups where host_id = $1::uuid and ended_at is null and expires_at > $3)`,
			me.ID, now.Add(-24*time.Hour), now,
		).Scan(&today, &active); err != nil {
			return err
		}
		if today >= maxMeetupsPerDay || active >= maxActiveHosted {
			return ErrTooMany
		}

		ids := make(map[string]string, len(guests))
		for _, handle := range guests {
			var id string
			err := tx.QueryRow(ctx,
				`select d.id::text from user_directory d
				 join friendships f on (f.user_low = d.id and f.user_high = $2::uuid) or (f.user_high = d.id and f.user_low = $2::uuid)
				 where d.username = $1`, handle, me.ID).Scan(&id)
			if errors.Is(err, pgx.ErrNoRows) {
				return invalid("You can only invite friends. @%s is not on your friends list.", handle)
			}
			if err != nil {
				return err
			}
			ids[handle] = id
			invited = append(invited, id)
		}

		var destUser, destPlace *string
		var lat, lng *float64
		switch in.Destination.Kind {
		case DestinationMember:
			handle, _ := normalizeUsername(in.Destination.Username)
			id := me.ID
			if handle != me.Username {
				id = ids[handle]
			}
			destUser = &id
		case DestinationPlace:
			place := strings.ToUpper(in.Destination.PlaceID)
			destPlace = &place
		case DestinationPin:
			lat, lng = in.Destination.Lat, in.Destination.Lng
		}

		var notePtr *string
		if note != "" {
			notePtr = &note
		}
		var meetupID string
		if err := tx.QueryRow(ctx,
			`insert into meetups (public_id, host_id, note, destination_kind, destination_user, destination_place, destination_lat, destination_lng, expires_at)
			 values ($1, $2::uuid, $3, $4, $5::uuid, $6, $7, $8, $9) returning id::text`,
			publicID, me.ID, notePtr, in.Destination.Kind, destUser, destPlace, lat, lng, now.Add(time.Duration(minutes)*time.Minute),
		).Scan(&meetupID); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx,
			`insert into meetup_members (meetup_id, user_id, role, status) values ($1::uuid, $2::uuid, 'host', 'joined')`,
			meetupID, me.ID); err != nil {
			return err
		}
		for _, handle := range guests {
			if _, err := tx.Exec(ctx,
				`insert into meetup_members (meetup_id, user_id, role, status) values ($1::uuid, $2::uuid, 'guest', 'invited')`,
				meetupID, ids[handle]); err != nil {
				return err
			}
		}

		created, err = s.load(ctx, tx, me, publicID)
		return err
	})
	if err == nil && len(invited) > 0 {
		name := me.DisplayName
		if name == "" {
			name = me.Username
		}
		s.ping(me.ID, invited, s.site.AppName, name+" invited you to walk together", "/")
	}
	return created, err
}

// load builds the meetup as the signed in member is allowed to see it.
func (s *Service) load(ctx context.Context, tx pgx.Tx, me auth.User, publicID string) (Meetup, error) {
	var m Meetup
	var meetupID, destKind string
	var destUsername, destPlace, destUserID, title *string
	var lat, lng *float64
	var endedAt *time.Time
	err := tx.QueryRow(ctx,
		`select m.id::text, m.public_id, m.visibility, m.title, m.starts_at, coalesce(m.note, ''), m.destination_kind,
		        m.destination_user::text, dest.username, m.destination_place, m.destination_lat, m.destination_lng,
		        m.created_at, m.expires_at, m.ended_at, host.username, coalesce(host.display_name, '')
		 from meetups m
		 join user_directory host on host.id = m.host_id
		 left join user_directory dest on dest.id = m.destination_user
		 where m.public_id = $1`, publicID,
	).Scan(&meetupID, &m.ID, &m.Visibility, &title, &m.StartsAt, &m.Note, &destKind, &destUserID, &destUsername,
		&destPlace, &lat, &lng, &m.CreatedAt, &m.ExpiresAt, &endedAt, &m.Host.Username, &m.Host.DisplayName)
	if errors.Is(err, pgx.ErrNoRows) {
		return Meetup{}, ErrMeetupNotFound
	}
	if err != nil {
		return Meetup{}, err
	}
	if title != nil {
		m.Title = *title
	}
	m.Active = endedAt == nil && m.ExpiresAt.After(s.now())

	rows, err := tx.Query(ctx,
		`select mm.user_id::text, d.username, coalesce(d.display_name, ''), mm.role, mm.status
		 from meetup_members mm join user_directory d on d.id = mm.user_id
		 where mm.meetup_id = $1::uuid
		 order by mm.role desc, lower(coalesce(d.display_name, d.username))
		 limit 60`, meetupID)
	if err != nil {
		return Meetup{}, err
	}
	defer rows.Close()
	type row struct {
		userID string
		member Member
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.userID, &r.member.Username, &r.member.DisplayName, &r.member.Role, &r.member.Status); err != nil {
			return Meetup{}, err
		}
		if r.userID == me.ID {
			m.YourRole, m.YourStatus = r.member.Role, r.member.Status
		}
		all = append(all, r)
	}
	if err := rows.Err(); err != nil {
		return Meetup{}, err
	}
	// Anyone signed in can look at a public meetup, even before saying they are going.
	if m.YourRole == "" {
		if m.Visibility != VisibilityPublic {
			return Meetup{}, ErrMeetupNotFound
		}
		m.YourRole, m.YourStatus = "guest", ""
	}

	joined := m.YourStatus == StatusJoined
	m.Members = make([]Member, 0, len(all))
	for _, r := range all {
		if joined && m.Visibility != VisibilityPublic && r.member.Status == StatusJoined {
			r.member.LiveID = s.liveID(m.ID, r.userID)
		}
		m.Members = append(m.Members, r.member)
	}
	if err := tx.QueryRow(ctx, `select csimap_meetup_going($1::uuid)`, meetupID).Scan(&m.Going); err != nil {
		return Meetup{}, err
	}
	if joined && m.Visibility == VisibilityPublic {
		// A public meetup keeps its place hidden until it starts, and never streams positions.
		if m.StartsAt != nil && s.now().Before(*m.StartsAt) {
			return m, nil
		}
		d := &Destination{Kind: destKind, Lat: lat, Lng: lng}
		if destPlace != nil {
			d.PlaceID = *destPlace
		}
		m.Destination = d
		return m, nil
	}
	if joined {
		m.YourLiveID = s.liveID(m.ID, me.ID)
		d := &Destination{Kind: destKind, Lat: lat, Lng: lng}
		if destPlace != nil {
			d.PlaceID = *destPlace
		}
		if destUsername != nil && destUserID != nil {
			d.Username = *destUsername
			d.LiveID = s.liveID(m.ID, *destUserID)
		}
		m.Destination = d
	}
	return m, nil
}

func (s *Service) ListMeetups(ctx context.Context, me auth.User) ([]Meetup, error) {
	out := []Meetup{}
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`select m.public_id from meetups m
			 join meetup_members mm on mm.meetup_id = m.id and mm.user_id = $1::uuid
			 where mm.status in ('invited', 'joined') and m.ended_at is null and m.expires_at > $2
			 order by m.created_at desc limit 20`, me.ID, s.now())
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, id := range ids {
			m, err := s.load(ctx, tx, me, id)
			if err != nil {
				return err
			}
			out = append(out, m)
		}
		return nil
	})
	return out, err
}

func validPublicID(id string) bool {
	return publicIDRe.MatchString(id)
}

func (s *Service) GetMeetup(ctx context.Context, me auth.User, publicID string) (Meetup, error) {
	if !validPublicID(publicID) {
		return Meetup{}, ErrMeetupNotFound
	}
	var m Meetup
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) (err error) {
		m, err = s.load(ctx, tx, me, publicID)
		return err
	})
	return m, err
}

// setStatus changes the signed in member's own status in an active meetup and returns the new view.
func (s *Service) setStatus(ctx context.Context, me auth.User, publicID, status string) (Meetup, error) {
	if !validPublicID(publicID) {
		return Meetup{}, ErrMeetupNotFound
	}
	var m Meetup
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		current, err := s.load(ctx, tx, me, publicID)
		if err != nil {
			return err
		}
		if !current.Active {
			return ErrMeetupOver
		}
		if current.YourRole == "host" && status != StatusLeft {
			return ErrNotHost
		}
		if current.YourRole == "host" {
			if _, err := tx.Exec(ctx, `update meetups set ended_at = $2 where public_id = $1`, publicID, s.now()); err != nil {
				return err
			}
		} else if _, err := tx.Exec(ctx,
			`update meetup_members set status = $3, updated_at = $4
			 where meetup_id = (select id from meetups where public_id = $1) and user_id = $2::uuid`,
			publicID, me.ID, status, s.now()); err != nil {
			return err
		}
		m, err = s.load(ctx, tx, me, publicID)
		return err
	})
	return m, err
}

func (s *Service) RespondToMeetup(ctx context.Context, me auth.User, publicID string, accept bool) (Meetup, error) {
	status := StatusDeclined
	if accept {
		status = StatusJoined
	}
	return s.setStatus(ctx, me, publicID, status)
}

// LeaveMeetup stops sharing and removes you from it. When the host leaves, the meetup ends for everyone.
func (s *Service) LeaveMeetup(ctx context.Context, me auth.User, publicID string) (Meetup, error) {
	return s.setStatus(ctx, me, publicID, StatusLeft)
}

func (s *Service) EndMeetup(ctx context.Context, me auth.User, publicID string) (Meetup, error) {
	if !validPublicID(publicID) {
		return Meetup{}, ErrMeetupNotFound
	}
	var m Meetup
	err := db.WithScope(ctx, s.pool, db.Scope{UserID: me.ID}, func(tx pgx.Tx) error {
		current, err := s.load(ctx, tx, me, publicID)
		if err != nil {
			return err
		}
		if current.YourRole != "host" {
			return ErrNotHost
		}
		if current.Active {
			if _, err := tx.Exec(ctx, `update meetups set ended_at = $2 where public_id = $1`, publicID, s.now()); err != nil {
				return err
			}
		}
		m, err = s.load(ctx, tx, me, publicID)
		return err
	})
	return m, err
}

// LiveTicket lets a joined member stream and share positions for a few minutes. The app asks for a
// new one before it runs out, so leaving or being removed cuts access quickly.
func (s *Service) LiveTicket(ctx context.Context, me auth.User, publicID string) (Ticket, error) {
	m, err := s.GetMeetup(ctx, me, publicID)
	if err != nil {
		return Ticket{}, err
	}
	if !m.Active {
		return Ticket{}, ErrMeetupOver
	}
	if m.YourStatus != StatusJoined {
		return Ticket{}, ErrNotJoined
	}
	expires := s.now().Add(ticketTTL)
	if m.ExpiresAt.Before(expires) {
		expires = m.ExpiresAt
	}
	token, err := ticket.Sign(s.ticketSecret, ticket.Claims{Room: m.ID, Member: m.YourLiveID, Name: me.DisplayName, Expires: expires.Unix()})
	if err != nil {
		return Ticket{}, err
	}
	return Ticket{Token: token, ExpiresAt: time.Unix(expires.Unix(), 0)}, nil
}

// Cleanup deletes meetups that ended more than a day ago. Their members go with them.
func (s *Service) Cleanup(ctx context.Context) error {
	return db.WithScope(ctx, s.pool, db.Scope{Maintenance: true}, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `delete from meetups where expires_at <= $1`, s.now().Add(-24*time.Hour))
		return err
	})
}
