-- Account wipe has to remove rows the student does not normally delete: leftover login codes,
-- meetups they host, membership in other meetups, and blocks aimed at them. CASCADE from users
-- runs as csimap_api, and those tables' delete policies would skip the rows or error. This
-- function runs as the table owner, but only for csimap_me(), so a request still cannot wipe
-- anyone else. Safe to run more than once.

create or replace function csimap_wipe_account() returns boolean
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    me uuid := csimap_me();
    idx bytea;
  begin
    if me is null then
      return false;
    end if;
    select email_index into idx from users where id = me;
    if not found then
      return false;
    end if;
    delete from login_codes where email_index = idx;
    delete from users where id = me;
    return true;
  end
  $$;

revoke all on function csimap_wipe_account() from public;
grant execute on function csimap_wipe_account() to csimap_api;
