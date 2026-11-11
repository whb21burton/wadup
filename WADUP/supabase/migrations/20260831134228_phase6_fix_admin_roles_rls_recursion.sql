-- The original admin_roles_select_own_or_super policy checked "is the
-- caller a super_admin" via a raw subquery against admin_roles itself,
-- which recurses infinitely (Postgres re-applies the same RLS policy to
-- the subquery's own scan of the same table) — every SELECT on admin_roles
-- from a real session has been erroring since this policy was created.
-- A SECURITY DEFINER function bypasses RLS on its own internal query
-- (it runs as the function owner, and RLS doesn't apply to a table's
-- owner by default), which breaks the recursion.
create or replace function is_super_admin_user(check_user_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from admin_roles where user_id = check_user_id and role = 'super_admin'
  );
$$;

drop policy if exists admin_roles_select_own_or_super on admin_roles;
create policy admin_roles_select_own_or_super
  on admin_roles for select
  to authenticated
  using (
    auth.uid() = user_id
    or is_super_admin_user(auth.uid())
  );
