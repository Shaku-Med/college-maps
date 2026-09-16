-- Accounts, sign in codes, and sessions.
--
-- Privacy: emails are never stored in plain text. email_index is an HMAC-SHA256 of the address
-- (a blind index used to find the account), and email_sealed is the address encrypted with
-- AES-256-GCM. Both keys are derived from AUTH_SECRET, so a copy of the database alone reveals
-- no emails, codes, or usable session tokens. Friends only ever see username and display_name.
--
-- Safe to run more than once, so pasting it into the Neon SQL editor cannot break an existing database.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email_index bytea not null unique check (octet_length(email_index) = 32),
  email_sealed bytea not null check (octet_length(email_sealed) between 30 and 400),
  username text unique check (username is null or username ~ '^[a-z0-9][a-z0-9_]{2,19}$'),
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Only a keyed hash of each code is kept, so the database cannot be used to guess codes offline.
create table if not exists login_codes (
  id bigint generated always as identity primary key,
  email_index bytea not null check (octet_length(email_index) = 32),
  code_hash bytea not null check (octet_length(code_hash) = 32),
  attempts smallint not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists login_codes_email_created on login_codes (email_index, created_at desc);
create index if not exists login_codes_expires on login_codes (expires_at);

-- Sessions store a keyed hash of the cookie token, never the token itself.
create table if not exists sessions (
  id bigint generated always as identity primary key,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create index if not exists sessions_user on sessions (user_id);
create index if not exists sessions_expires on sessions (expires_at);
create index if not exists sessions_last_seen on sessions (last_seen_at);
