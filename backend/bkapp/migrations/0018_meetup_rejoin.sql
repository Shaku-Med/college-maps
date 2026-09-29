-- Someone who leaves a meetup by mistake can be invited back into the same one, unless they said not to.
-- Members of a live meetup can also notify each other, so everyone hears when someone joins. Safe to run
-- more than once.

alter table meetup_members add column if not exists invites_off boolean not null default false;

-- Members only ever update their own row, so putting someone back on the invite list runs as the owner, with
-- every check the first invite had: the host's own live private meetup, still friends, nobody blocked, and
-- the member did not ask to stay out.
create or replace function csimap_reinvite_member(meetup uuid, target uuid)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = public
  as $$
  with changed as (
    update meetup_members mm
    set status = 'invited', updated_at = now()
    where mm.meetup_id = meetup
      and mm.user_id = target
      and mm.role = 'guest'
      and mm.status in ('left', 'declined')
      and not mm.invites_off
      and csimap_me() is not null
      and exists (
        select 1 from meetups m
        where m.id = meetup and m.host_id = csimap_me() and m.visibility = 'private'
          and m.ended_at is null and m.expires_at > now()
      )
      and exists (
        select 1 from friendships f
        where (f.user_low = csimap_me() and f.user_high = target) or (f.user_high = csimap_me() and f.user_low = target)
      )
      and not csimap_blocked_between(csimap_me(), target)
    returning 1
  )
  select exists (select 1 from changed);
  $$;

revoke all on function csimap_reinvite_member(uuid, uuid) from public;
grant execute on function csimap_reinvite_member(uuid, uuid) to csimap_api;

-- Push keys and app tokens are handed over for a live invite as before, and now also between two people who
-- are both in the same live meetup: everyone in a private one, or the host of a public one.
create or replace function csimap_push_keys(target uuid)
  returns table (endpoint text, p256dh text, auth text)
  language sql
  stable
  security definer
  set search_path = public
  as $$
  select s.endpoint, s.p256dh, s.auth
  from push_subscriptions s
  where s.user_id = target
    and csimap_me() is not null
    and target is distinct from csimap_me()
    and (
      exists (select 1 from friend_requests where from_user = csimap_me() and to_user = target)
      or exists (
        select 1
        from meetup_members gm
        join meetups mt on mt.id = gm.meetup_id
        where gm.user_id = target
          and mt.host_id = csimap_me()
          and gm.role = 'guest'
          and gm.status = 'invited'
          and mt.ended_at is null
          and mt.expires_at > now()
      )
      or exists (
        select 1
        from meetup_members mine
        join meetup_members theirs on theirs.meetup_id = mine.meetup_id
        join meetups mt on mt.id = mine.meetup_id
        where mine.user_id = csimap_me() and mine.status = 'joined'
          and theirs.user_id = target and theirs.status = 'joined'
          and (mt.visibility = 'private' or theirs.role = 'host')
          and mt.ended_at is null
          and mt.expires_at > now()
      )
    );
  $$;

create or replace function csimap_app_push_tokens(target uuid)
  returns table (token text)
  language sql
  stable
  security definer
  set search_path = public
  as $$
  select t.token
  from app_push_tokens t
  where t.user_id = target
    and csimap_me() is not null
    and target is distinct from csimap_me()
    and (
      exists (select 1 from friend_requests where from_user = csimap_me() and to_user = target)
      or exists (
        select 1
        from meetup_members gm
        join meetups mt on mt.id = gm.meetup_id
        where gm.user_id = target
          and mt.host_id = csimap_me()
          and gm.role = 'guest'
          and gm.status = 'invited'
          and mt.ended_at is null
          and mt.expires_at > now()
      )
      or exists (
        select 1
        from meetup_members mine
        join meetup_members theirs on theirs.meetup_id = mine.meetup_id
        join meetups mt on mt.id = mine.meetup_id
        where mine.user_id = csimap_me() and mine.status = 'joined'
          and theirs.user_id = target and theirs.status = 'joined'
          and (mt.visibility = 'private' or theirs.role = 'host')
          and mt.ended_at is null
          and mt.expires_at > now()
      )
    );
  $$;
