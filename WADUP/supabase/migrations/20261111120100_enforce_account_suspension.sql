-- Make profiles.is_suspended actually do something.
--
-- api/admin/moderate-review.js sets is_suspended = true, but nothing ever
-- read it: a suspended user could keep checking in, reviewing, voting,
-- saving, liking, reporting and editing their venue. The API routes now
-- check it (lib/profiles.js isSuspended); this covers the writes the
-- browser makes directly against the database.
--
-- A suspended user can still sign in and browse, and can still remove
-- their own saves/likes. Requires private schema from 20261110120100.

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_suspended
  );
$$;

revoke execute on function private.is_active_user() from public;
grant execute on function private.is_active_user() to authenticated;

-- RESTRICTIVE policies are ANDed with the existing permissive ones, so each
-- of these only ever narrows what's allowed today.
create policy saved_venues_insert_active on public.saved_venues
  as restrictive for insert to authenticated with check ((select private.is_active_user()));
create policy review_likes_insert_active on public.review_likes
  as restrictive for insert to authenticated with check ((select private.is_active_user()));
create policy review_reports_insert_active on public.review_reports
  as restrictive for insert to authenticated with check ((select private.is_active_user()));
create policy venue_photos_insert_active on public.venue_photos
  as restrictive for insert to authenticated with check ((select private.is_active_user()));
create policy profiles_update_active on public.profiles
  as restrictive for update to authenticated using ((select private.is_active_user()));
create policy venues_update_active on public.venues
  as restrictive for update to authenticated using ((select private.is_active_user()));

create policy venue_schedule_insert_active on public.venue_schedule
  as restrictive for insert to authenticated with check ((select private.is_active_user()));
create policy venue_schedule_update_active on public.venue_schedule
  as restrictive for update to authenticated using ((select private.is_active_user()));
create policy venue_schedule_delete_active on public.venue_schedule
  as restrictive for delete to authenticated using ((select private.is_active_user()));

create policy venue_events_insert_active on public.venue_events
  as restrictive for insert to authenticated with check ((select private.is_active_user()));
create policy venue_events_update_active on public.venue_events
  as restrictive for update to authenticated using ((select private.is_active_user()));
create policy venue_events_delete_active on public.venue_events
  as restrictive for delete to authenticated using ((select private.is_active_user()));

create policy venue_event_schedule_insert_active on public.venue_event_schedule
  as restrictive for insert to authenticated with check ((select private.is_active_user()));
create policy venue_event_schedule_update_active on public.venue_event_schedule
  as restrictive for update to authenticated using ((select private.is_active_user()));
create policy venue_event_schedule_delete_active on public.venue_event_schedule
  as restrictive for delete to authenticated using ((select private.is_active_user()));
