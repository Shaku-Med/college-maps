-- Reports about other students' events or accounts. Students can only file their own; nobody reads them
-- through the API. Cascade removes a reporter's rows when they delete their account. Safe to run more than once.

create table if not exists content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users (id) on delete cascade,
  -- meetup = a campus event or private meetup; user = another student's profile / behavior.
  target_kind text not null check (target_kind in ('meetup', 'user')),
  meetup_public_id text check (meetup_public_id is null or meetup_public_id ~ '^[A-Za-z0-9_-]{16}$'),
  reported_username text check (reported_username is null or reported_username ~ '^[a-z0-9][a-z0-9_]{2,19}$'),
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'other')),
  details text check (details is null or char_length(details) between 1 and 500),
  created_at timestamptz not null default now(),
  check (
    (target_kind = 'meetup' and meetup_public_id is not null)
    or (target_kind = 'user' and reported_username is not null)
  )
);

create index if not exists content_reports_reporter on content_reports (reporter_id, created_at desc);
create index if not exists content_reports_meetup on content_reports (meetup_public_id) where meetup_public_id is not null;
create index if not exists content_reports_user on content_reports (reported_username) where reported_username is not null;

alter table content_reports enable row level security;

revoke all on content_reports from public;
grant insert on content_reports to csimap_api;

drop policy if exists content_reports_insert_own on content_reports;
create policy content_reports_insert_own on content_reports
  for insert to csimap_api
  with check (reporter_id = csimap_me());
