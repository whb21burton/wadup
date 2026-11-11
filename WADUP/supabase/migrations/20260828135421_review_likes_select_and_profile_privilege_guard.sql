-- ── review_likes: allow users to read their own likes ──
create policy "review_likes_select_own"
  on review_likes for select
  to authenticated
  using (auth.uid() = user_id);

-- ── profiles: block client-side writes to wadup_points / account_type ──
-- Only the service_role (backend) may change these; any authenticated/anon
-- update attempt has these two columns silently reset to their prior values.
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() is distinct from 'service_role' then
    new.wadup_points := old.wadup_points;
    new.account_type := old.account_type;
  end if;
  return new;
end;
$$;

create trigger protect_profile_privileged_columns
  before update on public.profiles
  for each row
  execute function public.protect_profile_privileged_columns();
