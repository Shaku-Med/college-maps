-- Accounts that signed in but never set a name and username are removed after two days.
-- The API role may delete only those rows, and only during the hourly cleanup. Everything the
-- account owned (sessions, requests, meetups) goes with it through on delete cascade.
-- Safe to run more than once.

grant delete on users to csimap_api;

drop policy if exists users_incomplete_cleanup on users;
create policy users_incomplete_cleanup on users
  for delete to csimap_api
  using (
    csimap_maintenance()
    and (username is null or display_name is null)
    and created_at <= now() - interval '2 days'
  );
