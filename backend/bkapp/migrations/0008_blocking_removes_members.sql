-- Blocking someone should also get you out of their meetups, and them out of yours, so a block
-- really does end contact. You may remove your own membership, and a host may remove someone
-- from a meetup they host. Nothing else can delete these rows.
-- Safe to run more than once.

grant delete on meetup_members to csimap_api;

drop policy if exists meetup_members_remove on meetup_members;
create policy meetup_members_remove on meetup_members
  for delete to csimap_api
  using (
    user_id = csimap_me()
    or exists (select 1 from meetups m where m.id = meetup_id and m.host_id = csimap_me())
  );
