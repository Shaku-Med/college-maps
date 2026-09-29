-- Which notifications a student wants, kept with the account so the choice holds on every phone and browser.
-- Everything starts on. Safe to run more than once.

alter table user_settings add column if not exists notify_friend_requests boolean not null default true;
alter table user_settings add column if not exists notify_meetup_invites boolean not null default true;
alter table user_settings add column if not exists notify_meetup_joins boolean not null default true;

-- The sender's request is what triggers a notification, and it cannot read the recipient's settings row, so
-- the check runs as the owner. It answers only yes or no for one kind, and anything unknown is a yes.
create or replace function csimap_push_wanted(target uuid, kind text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
  as $$
  select coalesce((
    select case kind
      when 'friend' then s.notify_friend_requests
      when 'invite' then s.notify_meetup_invites
      when 'join' then s.notify_meetup_joins
      else true
    end
    from user_settings s
    where s.user_id = target
  ), true);
  $$;

revoke all on function csimap_push_wanted(uuid, text) from public;
grant execute on function csimap_push_wanted(uuid, text) to csimap_api;
