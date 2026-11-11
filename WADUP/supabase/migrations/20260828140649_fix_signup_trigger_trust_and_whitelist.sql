-- Fix 1: GoTrue (Supabase Auth) inserts into auth.users using its own privileged
-- connection, not a PostgREST request carrying request.jwt.claim.role, so
-- auth.role() reads NULL there — not 'service_role'. That made the profiles
-- INSERT guard silently force every signup (including venue owners) back to
-- account_type='user'. Add an explicit, transaction-local trusted-write flag
-- that only our own SECURITY DEFINER handle_new_user() can set.
create or replace function public.enforce_profile_defaults_on_insert()
returns trigger
language plpgsql
as $$
begin
  if auth.role() is distinct from 'service_role'
     and coalesce(current_setting('app.trusted_profile_write', true), '') <> 'true' then
    new.wadup_points := 0;
    new.account_type := 'user';
  end if;
  return new;
end;
$$;

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() is distinct from 'service_role'
     and coalesce(current_setting('app.trusted_profile_write', true), '') <> 'true' then
    new.wadup_points := old.wadup_points;
    new.account_type := old.account_type;
  end if;
  return new;
end;
$$;

-- Fix 2: signUp() options.data is fully client-controlled — whitelist
-- account_type to the two legitimate self-signup paths only ('user',
-- 'venue_owner'). Anything else (e.g. a hand-crafted 'admin') collapses to
-- 'user'. Set the trusted-write flag (transaction-local, cleared automatically)
-- so this trigger's own insert isn't clobbered by the guard above.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_type text := case
    when new.raw_user_meta_data->>'account_type' = 'venue_owner' then 'venue_owner'
    else 'user'
  end;
  v_username text := coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'business_name');
  v_phone    text := new.raw_user_meta_data->>'phone';
  v_city     text := new.raw_user_meta_data->>'city';
begin
  perform set_config('app.trusted_profile_write', 'true', true);

  insert into public.profiles (id, username, email, phone, city, is_local, account_type)
  values (new.id, v_username, new.email, v_phone, v_city, true, v_account_type);

  if v_account_type = 'venue_owner' then
    insert into public.venues (owner_id, name, category, city, phone)
    values (
      new.id,
      new.raw_user_meta_data->>'business_name',
      new.raw_user_meta_data->>'business_category',
      v_city,
      v_phone
    );
  end if;

  return new;
end;
$$;
