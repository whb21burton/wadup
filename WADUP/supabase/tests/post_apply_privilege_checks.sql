-- Read-only post-apply verification for the 20261110/20261111 security migrations.
-- Safe to run against production: catalog lookups only, no writes.
-- Every row should report pass = true once all six migrations are applied.
-- (Before 20261110120100 it errors on the missing private schema.)
with checks(name, pass) as (values
  -- 20261110120000: views are SELECT-only, stats views authenticated-only
  ('anon cannot write checkins_activity',      not (has_table_privilege('anon', 'public.checkins_activity', 'INSERT,UPDATE,DELETE'))),
  ('anon cannot write saved_venues_activity',  not (has_table_privilege('anon', 'public.saved_venues_activity', 'INSERT,UPDATE,DELETE'))),
  ('anon cannot write venue_views_activity',   not (has_table_privilege('anon', 'public.venue_views_activity', 'INSERT,UPDATE,DELETE'))),
  ('authenticated cannot write any activity view', not (
      has_table_privilege('authenticated', 'public.checkins_activity', 'INSERT,UPDATE,DELETE')
   or has_table_privilege('authenticated', 'public.saved_venues_activity', 'INSERT,UPDATE,DELETE')
   or has_table_privilege('authenticated', 'public.venue_views_activity', 'INSERT,UPDATE,DELETE'))),
  ('anon can read activity views',             has_table_privilege('anon', 'public.checkins_activity', 'SELECT')
                                               and has_table_privilege('anon', 'public.saved_venues_activity', 'SELECT')
                                               and has_table_privilege('anon', 'public.venue_views_activity', 'SELECT')),
  -- (20261111120000 re-grants these to anon for the now-working anon profile page)
  ('anon can read user stats views, read-only', has_table_privilege('anon', 'public.user_checkin_stats', 'SELECT')
                                               and has_table_privilege('anon', 'public.user_saved_stats', 'SELECT')
                                               and not has_table_privilege('anon', 'public.user_checkin_stats', 'INSERT,UPDATE,DELETE')
                                               and not has_table_privilege('anon', 'public.user_saved_stats', 'INSERT,UPDATE,DELETE')),
  ('authenticated can read user stats views',  has_table_privilege('authenticated', 'public.user_checkin_stats', 'SELECT')
                                               and has_table_privilege('authenticated', 'public.user_saved_stats', 'SELECT')),
  -- 20261110120100: functions
  ('trigger fns not executable by anon/authenticated', not exists (
      select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.prorettype = 'trigger'::regtype
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))),
  ('no public function has mutable search_path', not exists (
      select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proconfig is null)),
  ('admin_roles policy uses private.is_super_admin', exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_roles'
        and policyname = 'admin_roles_select_own_or_super' and qual like '%private.is_super_admin()%')),
  ('authenticated can execute private.is_super_admin', has_function_privilege('authenticated', 'private.is_super_admin()', 'EXECUTE')),
  ('anon cannot execute private.is_super_admin',  not has_schema_privilege('anon', 'private', 'USAGE')),
  ('review badge RPC still callable by anon',     has_function_privilege('anon', 'public.is_super_admin_user(uuid)', 'EXECUTE')),
  -- 20261110120200: privileged columns / direct writes
  ('authenticated cannot update profiles.is_suspended/is_local/account_type/email', not (
      has_column_privilege('authenticated', 'public.profiles', 'is_suspended', 'UPDATE')
   or has_column_privilege('authenticated', 'public.profiles', 'is_local', 'UPDATE')
   or has_column_privilege('authenticated', 'public.profiles', 'account_type', 'UPDATE')
   or has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE'))),
  ('no direct delete policies on venues/reviews', not exists (
      select 1 from pg_policies where schemaname = 'public' and cmd in ('DELETE', 'ALL')
        and tablename in ('venues', 'reviews'))),
  ('authenticated can update profiles.username',  has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE')),
  ('authenticated cannot update venue rating/moderation cols', not (
      has_column_privilege('authenticated', 'public.venues', 'weighted_rating', 'UPDATE')
   or has_column_privilege('authenticated', 'public.venues', 'admin_rating', 'UPDATE')
   or has_column_privilege('authenticated', 'public.venues', 'is_hidden', 'UPDATE')
   or has_column_privilege('authenticated', 'public.venues', 'is_verified', 'UPDATE')
   or has_column_privilege('authenticated', 'public.venues', 'owner_id', 'UPDATE'))),
  ('authenticated can update venues.description', has_column_privilege('authenticated', 'public.venues', 'description', 'UPDATE')),
  ('no direct insert policies on checkins/reviews/venue_flames/venues/profiles', not exists (
      select 1 from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'ALL')
        and tablename in ('checkins', 'reviews', 'venue_flames', 'venues', 'profiles'))),
  ('venue_views insert policy checks user_id', exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = 'venue_views'
        and cmd = 'INSERT' and with_check like '%auth.uid()%')),
  -- 20261111120000: profile contact fields
  ('anon/authenticated cannot select profiles.email or phone', not (
      has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT')
   or has_column_privilege('authenticated', 'public.profiles', 'phone', 'SELECT')
   or has_column_privilege('anon', 'public.profiles', 'email', 'SELECT')
   or has_column_privilege('anon', 'public.profiles', 'phone', 'SELECT'))),
  ('authenticated can select OWN_PROFILE_FIELDS', has_column_privilege('authenticated', 'public.profiles', 'id', 'SELECT')
      and has_column_privilege('authenticated', 'public.profiles', 'username', 'SELECT')
      and has_column_privilege('authenticated', 'public.profiles', 'city', 'SELECT')
      and has_column_privilege('authenticated', 'public.profiles', 'is_local', 'SELECT')
      and has_column_privilege('authenticated', 'public.profiles', 'account_type', 'SELECT')
      and has_column_privilege('authenticated', 'public.profiles', 'created_at', 'SELECT')),
  -- 20261111120100: suspension
  ('15 restrictive is_active_user policies', (select count(*) from pg_policies where schemaname = 'public'
      and permissive = 'RESTRICTIVE' and coalesce(qual, with_check) like '%private.is_active_user()%') = 15),
  ('authenticated can execute private.is_active_user', has_function_privilege('authenticated', 'private.is_active_user()', 'EXECUTE')),
  -- 20261111120200: owner signup venues start hidden
  ('handle_new_user creates venues hidden', (select prosrc from pg_proc where oid = 'public.handle_new_user()'::regprocedure) like '%is_hidden%'),
  -- unchanged behaviour that must survive
  ('triggers still attached', (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal and p.proname in ('handle_new_user', 'bump_venue_save_count', 'bump_venue_view_count',
        'sync_review_likes_count', 'protect_profile_privileged_columns', 'enforce_profile_defaults_on_insert',
        'protect_review_likes_column')) = 8)
)
select name, pass from checks order by pass, name;
