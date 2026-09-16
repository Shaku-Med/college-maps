-- Public campus meetups: anyone signed in can see them and say they are going, and the place is
-- only shown once the meetup starts. Live location sharing stays a private-meetup feature, so a
-- public meetup never streams anyone's position.
-- Safe to run more than once.

alter table meetups add column if not exists visibility text not null default 'private';
alter table meetups add column if not exists title text;
alter table meetups add column if not exists starts_at timestamptz;

alter table meetups drop constraint if exists meetups_visibility_check;
alter table meetups add constraint meetups_visibility_check check (visibility in ('private', 'public'));

alter table meetups drop constraint if exists meetups_title_check;
alter table meetups add constraint meetups_title_check check (title is null or char_length(title) between 3 and 60);

-- A public meetup needs a name and a start time, and meets at a place or a pin, never at a person.
alter table meetups drop constraint if exists meetups_public_shape;
alter table meetups add constraint meetups_public_shape check (
  (visibility = 'private' and title is null and starts_at is null)
  or (visibility = 'public' and title is not null and starts_at is not null and destination_kind in ('place', 'pin'))
);

create index if not exists meetups_public_upcoming on meetups (starts_at) where visibility = 'public';

drop policy if exists meetups_visible on meetups;
create policy meetups_visible on meetups
  for select to csimap_api
  using (
    host_id = csimap_me()
    or csimap_is_meetup_member(id)
    or (
      visibility = 'public'
      and ended_at is null
      and expires_at > now()
      and not csimap_blocked_between(host_id, csimap_me())
    )
  );

-- The host still invites friends to private meetups; anyone may add only themselves to a public one.
drop policy if exists meetup_members_invite on meetup_members;
create policy meetup_members_invite on meetup_members
  for insert to csimap_api
  with check (
    (
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
    )
    or (
      user_id = csimap_me()
      and role = 'guest'
      and exists (
        select 1 from meetups m
        where m.id = meetup_id
          and m.visibility = 'public'
          and m.ended_at is null
          and m.expires_at > now()
          and not csimap_blocked_between(m.host_id, csimap_me())
      )
    )
  );
