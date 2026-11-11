-- Lock the five aggregate views down to read-only, least-privilege access.
--
-- These views are deliberately SECURITY DEFINER (security_invoker = false):
-- checkins / saved_venues / venue_views restrict SELECT to the acting user's
-- own rows, and the views exist precisely to expose cross-user aggregates
-- (venue_id + timestamp, or per-user counts) without exposing who did what.
-- Switching them to security_invoker would make every caller see only their
-- own activity — silently zeroing discover's Trending / Most Popular
-- rankings (lib/rankings.js), the venue page's check-in count and other
-- users' profile stats. Opening the base tables' RLS instead would expose
-- user_id on every check-in / save, which is worse.
--
-- The actual hole: the views inherited Supabase's default ALL grants, and the
-- three *_activity views are simple single-table views, so Postgres makes
-- them automatically updatable. The owner (postgres) has BYPASSRLS, so the
-- anon key alone could DELETE or UPDATE every row of checkins, saved_venues
-- and venue_views through them.

revoke all on public.checkins_activity, public.saved_venues_activity, public.venue_views_activity,
  public.user_checkin_stats, public.user_saved_stats
  from public, anon, authenticated;

-- Logged-out visitors need these: discover rankings and the venue page's
-- check-in count are rendered for anonymous users too.
grant select on public.checkins_activity, public.saved_venues_activity, public.venue_views_activity
  to anon, authenticated;

-- Only read by pages/profile/[username].js. Anonymous visitors can't load a
-- profile anyway (anon has no SELECT on profiles.email, so its select('*')
-- fails), so anon gets nothing here.
grant select on public.user_checkin_stats, public.user_saved_stats to authenticated;

comment on view public.checkins_activity is
  'Intentionally SECURITY DEFINER: anonymized (venue_id, created_at) feed of all check-ins for rankings. SELECT-only; never grant write privileges — the view is auto-updatable and its owner bypasses RLS.';
comment on view public.saved_venues_activity is
  'Intentionally SECURITY DEFINER: anonymized (venue_id, created_at) feed of all saves for rankings. SELECT-only; never grant write privileges — the view is auto-updatable and its owner bypasses RLS.';
comment on view public.venue_views_activity is
  'Intentionally SECURITY DEFINER: anonymized (venue_id, viewed_at) feed of all venue views for rankings. SELECT-only; never grant write privileges — the view is auto-updatable and its owner bypasses RLS.';
comment on view public.user_checkin_stats is
  'Intentionally SECURITY DEFINER: per-user check-in counts for public profile pages. SELECT-only, authenticated only.';
comment on view public.user_saved_stats is
  'Intentionally SECURITY DEFINER: per-user saved-venue counts for public profile pages. SELECT-only, authenticated only.';
