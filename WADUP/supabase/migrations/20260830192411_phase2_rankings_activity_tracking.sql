-- Phase 2: activity tracking for rankings/discovery

alter table checkins add column if not exists created_at timestamptz default now();
alter table venues add column if not exists view_count integer default 0;
alter table venues add column if not exists save_count integer default 0;

create table if not exists venue_views (
  id uuid default gen_random_uuid() primary key,
  venue_id uuid references venues(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  viewed_at timestamptz default now()
);

create index if not exists venue_views_venue_id_idx on venue_views(venue_id);
create index if not exists venue_views_viewed_at_idx on venue_views(viewed_at);
create index if not exists checkins_venue_id_created_at_idx on checkins(venue_id, created_at);
create index if not exists saved_venues_venue_id_created_at_idx on saved_venues(venue_id, created_at);
create index if not exists reviews_venue_id_created_at_idx on reviews(venue_id, created_at);

alter table venue_views enable row level security;

-- Anyone (including anonymous visitors) can log a page view; there is no
-- SELECT policy on the base table itself, so raw rows (which carry user_id)
-- stay private even though inserts are open.
drop policy if exists venue_views_insert_public on venue_views;
create policy venue_views_insert_public
  on venue_views for insert
  to public
  with check (true);

-- checkins/saved_venues restrict SELECT to the acting user's own rows (by
-- design — nobody else should see what a specific person checked into or
-- saved), which blocks the aggregate trending/popularity math in
-- lib/rankings.js from seeing everyone's activity. These views expose only
-- venue_id + timestamp (never user_id) and run with the view owner's
-- privileges, which — unlike the querying client — isn't subject to the
-- underlying tables' row-level policies, so granting anon/authenticated
-- SELECT here is safe without loosening the base table policies.
create or replace view checkins_activity with (security_invoker = false) as
  select venue_id, created_at from checkins;

create or replace view saved_venues_activity with (security_invoker = false) as
  select venue_id, created_at from saved_venues;

create or replace view venue_views_activity with (security_invoker = false) as
  select venue_id, viewed_at from venue_views;

grant select on checkins_activity to anon, authenticated;
grant select on saved_venues_activity to anon, authenticated;
grant select on venue_views_activity to anon, authenticated;
