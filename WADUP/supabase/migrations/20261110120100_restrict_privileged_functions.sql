-- Narrow EXECUTE on privileged functions and pin search_path on the rest.

-- ── Trigger-only functions ──
-- None of these is meant to be reachable as /rest/v1/rpc/*. Postgres only
-- checks EXECUTE when a trigger is created, not each time it fires, so the
-- triggers on auth.users / saved_venues / venue_views / review_likes /
-- profiles / reviews keep working after this.
revoke execute on function
  public.bump_venue_save_count(),
  public.bump_venue_view_count(),
  public.handle_new_user(),
  public.sync_review_likes_count(),
  public.enforce_profile_defaults_on_insert(),
  public.protect_profile_privileged_columns(),
  public.protect_review_likes_column()
  from public, anon, authenticated;

-- Every name in these bodies is schema-qualified (auth.role(), public.*) or
-- lives in pg_catalog, so an empty search_path changes nothing but removes
-- the mutable-search-path risk.
alter function public.enforce_profile_defaults_on_insert() set search_path = '';
alter function public.protect_profile_privileged_columns() set search_path = '';
alter function public.protect_review_likes_column() set search_path = '';
alter function public.handle_new_user() set search_path = '';

-- ── Super-admin check used by admin_roles' own RLS policy ──
-- Moved to a schema PostgREST doesn't expose, and keyed on auth.uid()
-- rather than an argument, so the policy no longer depends on the public
-- arbitrary-user-id RPC below — that one can now be restricted or removed
-- independently without breaking admin authorization.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles
    where user_id = (select auth.uid()) and role = 'super_admin'
  );
$$;

revoke execute on function private.is_super_admin() from public;
grant execute on function private.is_super_admin() to authenticated;

drop policy admin_roles_select_own_or_super on public.admin_roles;
create policy admin_roles_select_own_or_super on public.admin_roles
  for select to authenticated
  using ((select auth.uid()) = user_id or (select private.is_super_admin()));

-- ── Public "is this reviewer a super admin" RPC ──
-- Still called by pages/venue/[id].js to put the admin badge on reviews, for
-- signed-in and anonymous visitors alike, so EXECUTE stays with anon and
-- authenticated. It answers for any user id, but only ever discloses what
-- that badge already shows publicly. Pinned search_path and marked STABLE;
-- EXECUTE is now an explicit grant instead of the PUBLIC default.
create or replace function public.is_super_admin_user(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles
    where user_id = check_user_id and role = 'super_admin'
  );
$$;

revoke execute on function public.is_super_admin_user(uuid) from public;
grant execute on function public.is_super_admin_user(uuid) to anon, authenticated, service_role;
