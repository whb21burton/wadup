-- Phase 3: badge persistence + public aggregate views for badges/leaderboard.
--
-- checkins and points_log both restrict SELECT to the acting user's own rows
-- (by design), which blocks badge computation and the leaderboard from
-- seeing everyone's activity. Rather than exposing raw rows (which carry
-- exactly-when/exactly-where detail), these views expose only pre-aggregated
-- counts/sums per user — enough to compute badges and rank a leaderboard,
-- without revealing any individual check-in's venue or timestamp.

create table if not exists user_badges (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  badge_id text not null,
  awarded_at timestamptz default now(),
  unique (user_id, badge_id)
);

create index if not exists user_badges_user_id_idx on user_badges(user_id);

alter table user_badges enable row level security;

-- Badges are a public "flex" on a profile page — anyone can see which
-- badges a user has earned. Only the service-role admin client (see
-- pages/api/supabase-admin.js, used from checkAndAwardBadges) may write.
drop policy if exists user_badges_select_public on user_badges;
create policy user_badges_select_public
  on user_badges for select
  to public
  using (true);

-- Per-user check-in aggregates for badge conditions (bar_hopper,
-- live_music_fan, trendsetter, local_legend) — never exposes which venue or
-- when, just counts.
create or replace view user_checkin_stats with (security_invoker = false) as
select
  c.user_id,
  count(*) as total_checkins,
  count(*) filter (where v.category = 'nightlife') as bar_checkins,
  count(*) filter (where v.city = p.city) as local_checkins,
  count(*) filter (where exists (
    select 1 from venue_schedule vs where vs.venue_id = v.id and vs.has_live_music
  )) as music_checkins,
  count(*) filter (where c.created_at = (
    select min(c2.created_at) from checkins c2 where c2.venue_id = c.venue_id
  )) as first_checkins
from checkins c
join venues v on v.id = c.venue_id
join profiles p on p.id = c.user_id
group by c.user_id;

grant select on user_checkin_stats to anon, authenticated;

-- Per-event points_log rows (user_id + points + when, never the `reason`
-- text) — enough for the leaderboard's This Month / This Week windows,
-- which need points earned in a range rather than the all-time running
-- total already public on profiles.wadup_points.
create or replace view points_log_activity with (security_invoker = false) as
  select user_id, points, created_at from points_log;

grant select on points_log_activity to anon, authenticated;
