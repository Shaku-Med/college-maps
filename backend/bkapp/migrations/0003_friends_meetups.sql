-- Friends, blocks, and private meetups.
--
-- Everything is keyed by internal ids, while the API only ever shows usernames and meetup public ids.
-- The API role reads other students through user_directory, which exposes username and display name
-- (never email) and only for people connected to the signed in user, or the one exact username being
-- looked up. Nobody can list every account. Live locations are never stored: rtapp keeps them in memory.
-- Safe to run more than once.

create table if not exists friend_requests (
  from_user uuid not null references users (id) on delete cascade,
  to_user uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user),
  check (from_user <> to_user)
);
create index if not exists friend_requests_to on friend_requests (to_user);

-- One row per pair, stored with the smaller id first so a friendship cannot be duplicated.
create table if not exists friendships (
  user_low uuid not null references users (id) on delete cascade,
  user_high uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low < user_high)
);
create index if not exists friendships_high on friendships (user_high);

create table if not exists blocks (
  blocker uuid not null references users (id) on delete cascade,
  blocked uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists blocks_blocked on blocks (blocked);

create table if not exists meetups (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique check (public_id ~ '^[A-Za-z0-9_-]{16}$'),
  host_id uuid not null references users (id) on delete cascade,
  note text check (note is null or char_length(note) between 1 and 80),
  destination_kind text not null check (destination_kind in ('member', 'place', 'pin')),
  destination_user uuid references users (id) on delete cascade,
  destination_place text check (destination_place is null or destination_place ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
  destination_lat double precision check (destination_lat between -90 and 90),
  destination_lng double precision check (destination_lng between -180 and 180),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  check (expires_at > created_at),
  check (
    (destination_kind = 'member' and destination_user is not null and destination_place is null and destination_lat is null and destination_lng is null)
    or (destination_kind = 'place' and destination_place is not null and destination_user is null and destination_lat is null and destination_lng is null)
    or (destination_kind = 'pin' and destination_lat is not null and destination_lng is not null and destination_user is null and destination_place is null)
  )
);
create index if not exists meetups_host on meetups (host_id);
create index if not exists meetups_expires on meetups (expires_at);

create table if not exists meetup_members (
  meetup_id uuid not null references meetups (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('host', 'guest')),
  status text not null check (status in ('invited', 'joined', 'declined', 'left')),
  updated_at timestamptz not null default now(),
  primary key (meetup_id, user_id)
);
create index if not exists meetup_members_user on meetup_members (user_id);

create or replace function csimap_me() returns uuid
  language sql stable
  as $$ select csimap_setting_uuid('app.user_id') $$;

-- These look across other people's rows, so they run as the table owner. Each answers one narrow
-- yes or no question about the signed in user and cannot be used to read data.
create or replace function csimap_blocked_between(a uuid, b uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a)) $$;

create or replace function csimap_is_meetup_member(meetup uuid) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from meetup_members where meetup_id = meetup and user_id = csimap_setting_uuid('app.user_id')) $$;

-- Invite emails need the guest's address. Only the host of that meetup gets it, and only for its guests.
create or replace function csimap_guest_email(meetup uuid, guest uuid) returns table (email_index bytea, email_sealed bytea)
  language sql stable security definer set search_path = public
  as $$
    select u.email_index, u.email_sealed
    from users u
    join meetup_members m on m.user_id = u.id and m.meetup_id = meetup and m.role = 'guest'
    join meetups mu on mu.id = meetup and mu.host_id = csimap_setting_uuid('app.user_id')
    where u.id = guest
  $$;

revoke all on function csimap_blocked_between(uuid, uuid), csimap_is_meetup_member(uuid), csimap_guest_email(uuid, uuid) from public;

create or replace view user_directory with (security_barrier = true) as
  select u.id, u.username, u.display_name
  from users u
  where u.username is not null and (
    u.id = csimap_me()
    or (
      u.username = nullif(current_setting('app.lookup_username', true), '')
      and not exists (select 1 from blocks b where b.blocker = u.id and b.blocked = csimap_me())
    )
    or exists (select 1 from friendships f where (f.user_low = u.id and f.user_high = csimap_me()) or (f.user_high = u.id and f.user_low = csimap_me()))
    or exists (select 1 from friend_requests r where (r.from_user = u.id and r.to_user = csimap_me()) or (r.to_user = u.id and r.from_user = csimap_me()))
    or exists (select 1 from blocks b where b.blocker = csimap_me() and b.blocked = u.id)
    or exists (
      select 1 from meetup_members mine join meetup_members theirs on theirs.meetup_id = mine.meetup_id
      where mine.user_id = csimap_me() and theirs.user_id = u.id
    )
  );

alter table friend_requests enable row level security;
alter table friendships enable row level security;
alter table blocks enable row level security;
alter table meetups enable row level security;
alter table meetup_members enable row level security;

revoke all on friend_requests, friendships, blocks, meetups, meetup_members, user_directory from public;
grant select, insert, delete on friend_requests, friendships, blocks to csimap_api;
grant select, insert, update, delete on meetups to csimap_api;
grant select, insert, update on meetup_members to csimap_api;
grant select on user_directory to csimap_api;
grant execute on function csimap_me(), csimap_blocked_between(uuid, uuid), csimap_is_meetup_member(uuid), csimap_guest_email(uuid, uuid) to csimap_api;

drop policy if exists friend_requests_mine on friend_requests;
create policy friend_requests_mine on friend_requests
  for select to csimap_api
  using (from_user = csimap_me() or to_user = csimap_me());

drop policy if exists friend_requests_send on friend_requests;
create policy friend_requests_send on friend_requests
  for insert to csimap_api
  with check (from_user = csimap_me() and not csimap_blocked_between(from_user, to_user));

drop policy if exists friend_requests_remove on friend_requests;
create policy friend_requests_remove on friend_requests
  for delete to csimap_api
  using (from_user = csimap_me() or to_user = csimap_me());

drop policy if exists friendships_mine on friendships;
create policy friendships_mine on friendships
  for select to csimap_api
  using (user_low = csimap_me() or user_high = csimap_me());

-- A friendship can only be created by accepting a request the other person sent.
drop policy if exists friendships_accept on friendships;
create policy friendships_accept on friendships
  for insert to csimap_api
  with check (
    (user_low = csimap_me() or user_high = csimap_me())
    and exists (
      select 1 from friend_requests r
      where r.to_user = csimap_me()
        and r.from_user = case when user_low = csimap_me() then user_high else user_low end
    )
  );

drop policy if exists friendships_remove on friendships;
create policy friendships_remove on friendships
  for delete to csimap_api
  using (user_low = csimap_me() or user_high = csimap_me());

drop policy if exists blocks_mine on blocks;
create policy blocks_mine on blocks
  for all to csimap_api
  using (blocker = csimap_me())
  with check (blocker = csimap_me());

drop policy if exists meetups_visible on meetups;
create policy meetups_visible on meetups
  for select to csimap_api
  using (host_id = csimap_me() or csimap_is_meetup_member(id));

drop policy if exists meetups_create on meetups;
create policy meetups_create on meetups
  for insert to csimap_api
  with check (host_id = csimap_me());

drop policy if exists meetups_host_update on meetups;
create policy meetups_host_update on meetups
  for update to csimap_api
  using (host_id = csimap_me())
  with check (host_id = csimap_me());

drop policy if exists meetups_cleanup on meetups;
create policy meetups_cleanup on meetups
  for delete to csimap_api
  using (csimap_maintenance() and expires_at <= now() - interval '1 day');

drop policy if exists meetup_members_visible on meetup_members;
create policy meetup_members_visible on meetup_members
  for select to csimap_api
  using (user_id = csimap_me() or csimap_is_meetup_member(meetup_id));

-- Only the host adds people, and only themselves or current friends who have not blocked them.
drop policy if exists meetup_members_invite on meetup_members;
create policy meetup_members_invite on meetup_members
  for insert to csimap_api
  with check (
    exists (select 1 from meetups m where m.id = meetup_id and m.host_id = csimap_me())
    and (
      user_id = csimap_me()
      or (
        exists (
          select 1 from friendships f
          where (f.user_low = csimap_me() and f.user_high = user_id) or (f.user_high = csimap_me() and f.user_low = user_id)
        )
        and not csimap_blocked_between(csimap_me(), user_id)
      )
    )
  );

drop policy if exists meetup_members_respond on meetup_members;
create policy meetup_members_respond on meetup_members
  for update to csimap_api
  using (user_id = csimap_me())
  with check (user_id = csimap_me());
