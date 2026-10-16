-- Problems students report with the map or the app, read in the database console. Safe to run more than once.

create table if not exists issue_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('bug', 'map', 'idea', 'other')),
  message text not null check (char_length(message) between 10 and 1000),
  place_id text check (place_id is null or place_id ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,15}$'),
  platform text not null check (platform in ('web', 'ios', 'android')),
  app_version text check (app_version is null or app_version ~ '^[0-9]{1,3}(\.[0-9]{1,3}){1,2}$'),
  may_contact boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists issue_reports_reporter on issue_reports (reporter_id, created_at desc);
create index if not exists issue_reports_recent on issue_reports (created_at desc);

alter table issue_reports enable row level security;

revoke all on issue_reports from public;
grant insert, select on issue_reports to csimap_api;

drop policy if exists issue_reports_insert_own on issue_reports;
create policy issue_reports_insert_own on issue_reports
  for insert to csimap_api
  with check (reporter_id = csimap_me());

-- The daily cap counts a reporter's own rows, so they need to see those and nothing else.
drop policy if exists issue_reports_select_own on issue_reports;
create policy issue_reports_select_own on issue_reports
  for select to csimap_api
  using (reporter_id = csimap_me());
