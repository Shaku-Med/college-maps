-- Each phone can turn its icon badge off. The choice sits with the phone's token, so a notification that
-- arrives while the app is closed does not put the number back. Safe to run more than once.

alter table app_push_tokens add column if not exists badge boolean not null default true;

-- Same rule as before for who may reach a phone, now also saying whether that phone wants a badge.
drop function if exists csimap_app_push_tokens(uuid);
create function csimap_app_push_tokens(target uuid)
  returns table (token text, badge boolean)
  language sql
  stable
  security definer
  set search_path = public
  as $$
  select t.token, t.badge
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

revoke all on function csimap_app_push_tokens(uuid) from public;
grant execute on function csimap_app_push_tokens(uuid) to csimap_api;
