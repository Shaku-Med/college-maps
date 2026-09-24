-- A student's app preferences, such as the navigation voice, kept with the account so they follow the
-- student to any device. Only the owner can read or change them, and they go with the account when it is
-- deleted. Safe to run more than once.

create table if not exists user_settings (
  user_id uuid primary key references users (id) on delete cascade,
  -- The API only accepts voices from its own list; this is a second fence in case that ever slips.
  voice text check (voice is null or voice ~ '^(device|[a-z]{2}_[a-z]{2,16})$'),
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

revoke all on user_settings from public;
grant select, insert, update, delete on user_settings to csimap_api;

drop policy if exists user_settings_own on user_settings;
create policy user_settings_own on user_settings
  for all to csimap_api
  using (user_id = csimap_me())
  with check (user_id = csimap_me());
