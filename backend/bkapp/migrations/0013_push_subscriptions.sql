-- Web Push subscriptions for the installed app. Endpoints are HTTPS URLs with a secret
-- path, so they never leave this student's own API responses except in their data export.
-- Notifications stay off when VAPID keys are missing. Safe to run more than once.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 12 and 2048),
  p256dh text not null check (char_length(p256dh) between 20 and 256),
  auth text not null check (char_length(auth) between 8 and 256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

revoke all on push_subscriptions from public;
grant select, insert, update, delete on push_subscriptions to csimap_api;

drop policy if exists push_subscriptions_own on push_subscriptions;
create policy push_subscriptions_own on push_subscriptions
  for all to csimap_api
  using (user_id = csimap_me())
  with check (user_id = csimap_me());

-- The sender needs the recipient's endpoints to deliver a friend or meetup ping. This only
-- returns keys when the signed-in user already has a live invite relationship with them.
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
    );
  $$;

revoke all on function csimap_push_keys(uuid) from public;
grant execute on function csimap_push_keys(uuid) to csimap_api;
