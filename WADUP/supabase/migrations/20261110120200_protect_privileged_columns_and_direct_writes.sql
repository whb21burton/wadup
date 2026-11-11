-- Close direct-table paths that bypass the server-side rules in pages/api/*.
--
-- Every write below is one the app only ever performs through a
-- service-role API route (supabaseAdmin), which is unaffected by RLS
-- policies and column grants. Nothing in pages/, components/ or lib/ issues
-- these writes from the browser, so this removes no app functionality.

-- ── profiles ──
-- Users could flip their own is_suspended (lifting a moderation suspension
-- set by pages/api/admin/moderate-review.js) or is_local (10x rating and
-- flame weight in lib/rankings.js / api/venues/flame.js). account_type stays
-- guarded by its trigger as well. email is copied from auth.users at signup
-- and is what the super-admin user search matches on, so users can't
-- rewrite it to impersonate someone else there.
revoke insert, update on public.profiles from anon, authenticated;
grant update (username, phone, city) on public.profiles to authenticated;
-- Profiles are created by handle_new_user (SECURITY DEFINER) at signup.
drop policy profiles_insert_own on public.profiles;

-- ── venues ──
-- Owners could rewrite their own venue's ratings, verification, visibility
-- (un-hiding an admin hide) and ranking columns. Owners keep the descriptive
-- columns; everything else is admin-only via api/admin/update-venue.js. The
-- save/view counters are maintained by SECURITY DEFINER triggers running as
-- postgres, which these grants don't touch.
revoke insert, update on public.venues from anon, authenticated;
grant update (
  name, category, subcategory, subcategories, categories, custom_subcategories,
  address, city, state, lat, lng, phone, website, description,
  cover_photo_url, custom_cover_photo, social_links, hours, custom_emoji
) on public.venues to authenticated;
-- A venue owner's venue is created by handle_new_user at signup; any other
-- insert goes through the admin approval routes.
drop policy venues_insert_owner on public.venues;
-- Deleting a venue must go through api/admin/delete-venue.js, which records
-- it in deleted_venues so the Google Places sync doesn't re-add it.
drop policy venues_delete_owner on public.venues;

-- ── checkins ── enforce api/checkin.js's 4-hour cooldown
drop policy checkins_insert_own on public.checkins;

-- ── reviews ── enforce api/reviews/submit.js's check-in gate and weighted
-- rating recalculation; also stops authors forging business_response.
drop policy reviews_insert_author on public.reviews;
drop policy reviews_update_author on public.reviews;
-- A direct delete would leave venues.weighted_rating counting the deleted
-- review until the next submit; moderation deletes go through
-- api/admin/moderate-review.js.
drop policy reviews_delete_author on public.reviews;

-- ── venue_flames ── weight must come from api/venues/flame.js, not the client
drop policy "anyone can insert flames" on public.venue_flames;

-- ── venue_views ── still insertable by anyone (pages/venue/[id].js), but a
-- view can no longer be attributed to some other user.
drop policy venue_views_insert_public on public.venue_views;
create policy venue_views_insert_public on public.venue_views
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));
