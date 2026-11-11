-- Stop exposing every user's email and phone to every signed-in user.
--
-- profiles_select_public (USING true) lets any authenticated user read every
-- profile row, and authenticated held table-level SELECT, so email and phone
-- were readable for all users by anyone with an account. RLS can't hide
-- columns, so this switches authenticated to a column-level grant — the same
-- approach anon has used since public_readable_profiles_safe_columns.
--
-- DEPLOY ORDER: the frontend on branch security/db-hardening-phase2 must be
-- live first. The old frontend's profiles select('*') calls fail outright
-- once email/phone aren't selectable. The new frontend selects explicit
-- columns (lib/profiles.js) and reads email only through service-role admin
-- routes (pages/api/admin/users.js), so it works before and after this.

revoke select on public.profiles from authenticated;
grant select (id, username, city, is_local, account_type, created_at) on public.profiles to authenticated;
-- anon is unchanged: (id, username, city, is_local, created_at).

-- With explicit columns, pages/profile/[username].js now loads for
-- logged-out visitors too (its select('*') used to fail for anon), so its
-- check-in / saved counts need to be readable by anon again. These are the
-- same per-user counts any signed-in stranger can already see.
grant select on public.user_checkin_stats, public.user_saved_stats to anon;
comment on view public.user_checkin_stats is
  'Intentionally SECURITY DEFINER: per-user check-in counts for public profile pages. SELECT-only; never grant write privileges.';
comment on view public.user_saved_stats is
  'Intentionally SECURITY DEFINER: per-user saved-venue counts for public profile pages. SELECT-only; never grant write privileges.';
