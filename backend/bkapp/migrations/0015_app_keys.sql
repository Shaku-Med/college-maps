-- Keys the server itself needs on every instance, such as the Web Push keypair. Hosts without a lasting
-- disk, like Vercel, cannot keep them in a file: every new instance would make its own and break every
-- notification subscription. So they live here, sealed with a key derived from AUTH_SECRET.
-- The API role gets no access at all. Only the server's own startup, connected as the owner, reads them.
-- Safe to run more than once.

create table if not exists app_keys (
  name text primary key check (name ~ '^[a-z][a-z0-9_]{1,40}$'),
  sealed bytea not null check (octet_length(sealed) between 29 and 4096),
  created_at timestamptz not null default now()
);

alter table app_keys enable row level security;

revoke all on app_keys from public;
revoke all on app_keys from csimap_api;
