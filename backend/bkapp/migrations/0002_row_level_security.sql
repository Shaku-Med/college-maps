-- Row level security on every table.
--
-- The connection string's user (neondb_owner on Neon) owns the tables and has BYPASSRLS, so RLS
-- alone would not limit it. The API therefore switches to the restricted csimap_api role at the
-- start of every transaction and states which rows the request is about through settings:
--
--   app.email_index  hex blind index of the email being signed in
--   app.token_hash   hex hash of the session cookie being checked
--   app.user_id      id of the signed in user
--   app.maintenance  'on' only for the hourly cleanup of expired rows
--
-- A query can only reach rows matching those settings, so a bug or injected SQL in one request
-- cannot read or change another student's account. Migrations and the owner's cmd/users tool run
-- as the table owner, which RLS does not restrict without FORCE. Safe to run more than once.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'csimap_api') then
    create role csimap_api nologin noinherit;
  end if;
end
$$;

grant csimap_api to current_user;

create or replace function csimap_setting_bytes(name text) returns bytea
  language sql stable
  as $$ select decode(nullif(current_setting(name, true), ''), 'hex') $$;

create or replace function csimap_setting_uuid(name text) returns uuid
  language sql stable
  as $$ select nullif(current_setting(name, true), '')::uuid $$;

create or replace function csimap_maintenance() returns boolean
  language sql stable
  as $$ select coalesce(current_setting('app.maintenance', true), '') = 'on' $$;

alter table users enable row level security;
alter table login_codes enable row level security;
alter table sessions enable row level security;
alter table schema_migrations enable row level security;

revoke all on users, login_codes, sessions, schema_migrations from public;
grant usage on schema public to csimap_api;
grant select, insert, update on users to csimap_api;
grant select, insert, update, delete on login_codes, sessions to csimap_api;
grant execute on function csimap_setting_bytes(text), csimap_setting_uuid(text), csimap_maintenance() to csimap_api;
-- schema_migrations gets no grant and no policy, so the API role cannot see or change it.

-- Codes belong to the email in the current request. Cleanup may only remove codes expired a day ago.
drop policy if exists login_codes_for_email on login_codes;
create policy login_codes_for_email on login_codes
  for all to csimap_api
  using (email_index = csimap_setting_bytes('app.email_index'))
  with check (email_index = csimap_setting_bytes('app.email_index'));

drop policy if exists login_codes_cleanup on login_codes;
create policy login_codes_cleanup on login_codes
  for delete to csimap_api
  using (csimap_maintenance() and expires_at <= now() - interval '1 day');

-- Sessions are found by their own cookie hash, or all of them for the signed in user.
drop policy if exists sessions_for_request on sessions;
create policy sessions_for_request on sessions
  for all to csimap_api
  using (
    token_hash = csimap_setting_bytes('app.token_hash')
    or user_id = csimap_setting_uuid('app.user_id')
  )
  with check (
    user_id = csimap_setting_uuid('app.user_id')
    or token_hash = csimap_setting_bytes('app.token_hash')
  );

drop policy if exists sessions_cleanup on sessions;
create policy sessions_cleanup on sessions
  for delete to csimap_api
  using (csimap_maintenance() and (expires_at <= now() or last_seen_at <= now() - interval '14 days'));

-- A user row is visible only as the email signing in, the signed in user, or through the session
-- cookie presented with the request. Rows are never deleted by the API.
drop policy if exists users_for_request on users;
create policy users_for_request on users
  for all to csimap_api
  using (
    email_index = csimap_setting_bytes('app.email_index')
    or id = csimap_setting_uuid('app.user_id')
    or exists (
      select 1 from sessions s
      where s.user_id = users.id and s.token_hash = csimap_setting_bytes('app.token_hash')
    )
  )
  with check (
    email_index = csimap_setting_bytes('app.email_index')
    or id = csimap_setting_uuid('app.user_id')
  );
