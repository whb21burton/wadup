-- ── profiles: force safe defaults on insert unless service_role ──
-- Prevents a client from self-granting points or an elevated account_type
-- at signup time (the INSERT RLS policy only checks auth.uid() = id, not
-- column values).
create or replace function public.enforce_profile_defaults_on_insert()
returns trigger
language plpgsql
as $$
begin
  if auth.role() is distinct from 'service_role' then
    new.wadup_points := 0;
    new.account_type := 'user';
  end if;
  return new;
end;
$$;

create trigger enforce_profile_defaults_on_insert
  before insert on public.profiles
  for each row
  execute function public.enforce_profile_defaults_on_insert();
