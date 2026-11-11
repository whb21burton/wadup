-- Reviews are publicly readable and embed the reviewer's profile (username,
-- city, is_local) — but profiles SELECT was scoped to `authenticated` only,
-- so anonymous visitors got profiles: null on every review (verified against
-- the live REST API). Widen SELECT to everyone, but keep contact/gamification
-- fields restricted to authenticated via column-level privilege, not just RLS
-- (RLS is row-level only — it can't hide individual columns on its own).
drop policy if exists "profiles_select_authenticated" on profiles;

create policy "profiles_select_public"
  on profiles for select
  using (true);

revoke select (email, phone, wadup_points, account_type) on profiles from anon;
