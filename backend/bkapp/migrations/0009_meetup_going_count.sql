-- How many people are going is public on the campus board, while who they are is not. This counts
-- them without exposing the rows, so someone who has not joined still sees a real number.
-- Safe to run more than once.

create or replace function csimap_meetup_going(meetup uuid) returns integer
  language sql stable security definer set search_path = public
  as $$ select count(*)::int from meetup_members where meetup_id = meetup and status = 'joined' $$;

revoke all on function csimap_meetup_going(uuid) from public;
grant execute on function csimap_meetup_going(uuid) to csimap_api;
