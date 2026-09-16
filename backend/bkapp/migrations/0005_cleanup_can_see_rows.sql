-- Postgres only lets a DELETE with a WHERE clause remove rows the role can also SELECT. The cleanup
-- delete policies had no matching read policy, so the hourly cleanup found nothing to delete.
-- These let the cleanup, and only the cleanup, see exactly the rows it is allowed to remove.
-- Safe to run more than once.

drop policy if exists login_codes_cleanup_read on login_codes;
create policy login_codes_cleanup_read on login_codes
  for select to csimap_api
  using (csimap_maintenance() and expires_at <= now() - interval '1 day');

drop policy if exists sessions_cleanup_read on sessions;
create policy sessions_cleanup_read on sessions
  for select to csimap_api
  using (csimap_maintenance() and (expires_at <= now() or last_seen_at <= now() - interval '14 days'));

drop policy if exists meetups_cleanup_read on meetups;
create policy meetups_cleanup_read on meetups
  for select to csimap_api
  using (csimap_maintenance() and expires_at <= now() - interval '1 day');

drop policy if exists users_incomplete_cleanup_read on users;
create policy users_incomplete_cleanup_read on users
  for select to csimap_api
  using (
    csimap_maintenance()
    and (username is null or display_name is null)
    and created_at <= now() - interval '2 days'
  );
