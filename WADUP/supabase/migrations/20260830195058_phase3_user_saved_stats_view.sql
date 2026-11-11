-- Per-user saved-venue count for the profile page's stats row — saved_venues
-- itself restricts SELECT to the acting user's own rows (bookmarks are
-- private), so the profile page's "Places Saved: N" stat needs the same
-- aggregate-view treatment as checkins.
create or replace view user_saved_stats with (security_invoker = false) as
  select user_id, count(*) as saved_count from saved_venues group by user_id;

grant select on user_saved_stats to anon, authenticated;
