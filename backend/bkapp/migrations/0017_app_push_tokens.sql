-- Push tokens for the iPhone app, delivered through Expo's push service. A token only reaches the phone it
-- came from, and like web push subscriptions it is only ever handed to a sender who has a live invite
-- relationship with the owner. Safe to run more than once.

create table if not exists app_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token text not null unique check (token ~ '^ExponentPushToken\[[A-Za-z0-9_-]{8,128}\]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_push_tokens_user on app_push_tokens (user_id);

alter table app_push_tokens enable row level security;

revoke all on app_push_tokens from public;
grant select, insert, update, delete on app_push_tokens to csimap_api;

drop policy if exists app_push_tokens_own on app_push_tokens;
create policy app_push_tokens_own on app_push_tokens
  for all to csimap_api
  using (user_id = csimap_me())
  with check (user_id = csimap_me());

-- A phone handed to someone else, or signed out while offline, keeps its token. Saving it for the new account
-- moves it there, so the previous account's notifications never show up on a phone that is no longer theirs.
-- This runs as the owner because the row belongs to the other account until it moves.
create or replace function csimap_claim_app_push_token(value text)
  returns void
  language sql
  volatile
  security definer
  set search_path = public
  as $$
  update app_push_tokens set user_id = csimap_me(), updated_at = now()
  where token = value and csimap_me() is not null and user_id is distinct from csimap_me();
  $$;

revoke all on function csimap_claim_app_push_token(text) from public;
grant execute on function csimap_claim_app_push_token(text) to csimap_api;

-- The same rule as csimap_push_keys: only someone with a pending friend request to the owner, or who invited
-- them to a live meetup, gets their tokens.
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
    );
  $$;

revoke all on function csimap_app_push_tokens(uuid) from public;
grant execute on function csimap_app_push_tokens(uuid) to csimap_api;

-- A token Expo reports as no longer registered is removed by the sender, who cannot see the row itself.
create or replace function csimap_forget_app_push_token(value text)
  returns void
  language sql
  volatile
  security definer
  set search_path = public
  as $$
  delete from app_push_tokens t
  where t.token = value
    and csimap_me() is not null
    and exists (select 1 from csimap_app_push_tokens(t.user_id) allowed where allowed.token = value);
  $$;

revoke all on function csimap_forget_app_push_token(text) from public;
grant execute on function csimap_forget_app_push_token(text) to csimap_api;
