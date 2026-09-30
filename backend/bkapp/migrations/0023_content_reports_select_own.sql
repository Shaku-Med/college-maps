-- Let a reporter count their own recent rows so the hourly report cap in the API actually works under RLS.
-- Safe to run more than once.

grant select on content_reports to csimap_api;

drop policy if exists content_reports_select_own on content_reports;
create policy content_reports_select_own on content_reports
  for select to csimap_api
  using (reporter_id = csimap_me());
