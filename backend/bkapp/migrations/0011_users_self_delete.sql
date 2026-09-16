-- Signed-in students may delete their own account. Friends, blocks, hosted meetups, membership
-- in other meetups, and sessions go with the user row through on delete cascade. Login codes are
-- keyed by email, not user id, so the API deletes those in the same request under the email-index
-- scope.
--
-- users_for_request used FOR ALL, which included DELETE, so an email-index scope (a sign-in code
-- request) could have removed the row. DELETE is now only self-delete and incomplete-account cleanup.
-- Safe to run more than once.

drop policy if exists users_for_request on users;
drop policy if exists users_for_request_select on users;
drop policy if exists users_for_request_insert on users;
drop policy if exists users_for_request_update on users;

create policy users_for_request_select on users
  for select to csimap_api
  using (
    email_index = csimap_setting_bytes('app.email_index')
    or id = csimap_setting_uuid('app.user_id')
    or exists (
      select 1 from sessions s
      where s.user_id = users.id and s.token_hash = csimap_setting_bytes('app.token_hash')
    )
  );

create policy users_for_request_insert on users
  for insert to csimap_api
  with check (
    email_index = csimap_setting_bytes('app.email_index')
    or id = csimap_setting_uuid('app.user_id')
  );

create policy users_for_request_update on users
  for update to csimap_api
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

drop policy if exists users_self_delete on users;
create policy users_self_delete on users
  for delete to csimap_api
  using (id = csimap_me());
