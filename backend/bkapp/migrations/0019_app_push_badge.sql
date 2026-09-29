-- The number on the app icon: friend requests and meetup invites still waiting for an answer. It rides along
-- with a notification to the owner's phone, so it only counts for a sender who may notify them at all, and
-- the sender never sees it. Safe to run more than once.
create or replace function csimap_app_push_badge(target uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = public
  as $$
  select case
    when exists (select 1 from csimap_app_push_tokens(target)) then
      (select count(*)::int from friend_requests where to_user = target)
      + (select count(*)::int
         from meetup_members mm
         join meetups m on m.id = mm.meetup_id
         where mm.user_id = target and mm.status = 'invited' and m.ended_at is null and m.expires_at > now())
    else 0
  end;
  $$;

revoke all on function csimap_app_push_badge(uuid) from public;
grant execute on function csimap_app_push_badge(uuid) to csimap_api;
