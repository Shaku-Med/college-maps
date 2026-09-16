-- The public host rule from 0007 also matched when no user was signed in, so a query with no user
-- could list the hosts of current public meetups. Every branch now requires a signed in user.
-- Safe to run more than once.

create or replace view user_directory with (security_barrier = true) as
  select u.id, u.username, u.display_name
  from users u
  where u.username is not null and csimap_me() is not null and (
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
    or exists (
      select 1 from meetups m
      where m.host_id = u.id
        and m.visibility = 'public'
        and m.ended_at is null
        and m.expires_at > now()
        and not csimap_blocked_between(u.id, csimap_me())
    )
  );

grant select on user_directory to csimap_api;
