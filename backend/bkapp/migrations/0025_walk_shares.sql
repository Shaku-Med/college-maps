-- A walk is someone sharing their live location with a few friends until they get where they are going.
-- It reuses meetups, so ending, expiry and cleanup work the same. Safe to run more than once.

alter table meetups add column if not exists kind text not null default 'meetup';

alter table meetups drop constraint if exists meetups_kind_check;
alter table meetups add constraint meetups_kind_check check (kind in ('meetup', 'walk'));

alter table meetups drop constraint if exists meetups_walk_shape;
alter table meetups add constraint meetups_walk_shape check (
  kind = 'meetup' or (visibility = 'private' and destination_kind in ('place', 'pin'))
);

create index if not exists meetups_host_live_walks on meetups (host_id) where kind = 'walk' and ended_at is null;
