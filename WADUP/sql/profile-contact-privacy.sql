-- Apply only after the explicit profile reads and protected admin lookup are deployed.
begin;

revoke select on table public.profiles from public, anon, authenticated;
revoke select (email, phone) on table public.profiles from public, anon, authenticated;
grant select (id, username, city, is_local, account_type, created_at, is_suspended)
  on table public.profiles to anon, authenticated;

commit;
