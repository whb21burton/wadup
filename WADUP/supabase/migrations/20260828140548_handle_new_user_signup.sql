-- Creates the profiles row (and, for venue owners, the venues row) automatically
-- whenever a new auth user is created. Reads the extra signup fields out of
-- raw_user_meta_data (passed via supabase.auth.signUp({ options: { data } })).
-- Runs as SECURITY DEFINER so it works regardless of whether email confirmation
-- is required (i.e. even before the client has an authenticated session).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_type text := coalesce(new.raw_user_meta_data->>'account_type', 'user');
  v_username     text := coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'business_name');
  v_phone        text := new.raw_user_meta_data->>'phone';
  v_city         text := new.raw_user_meta_data->>'city';
begin
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
