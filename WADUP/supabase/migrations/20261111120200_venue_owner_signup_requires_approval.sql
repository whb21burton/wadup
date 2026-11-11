-- Venues created by self-service venue-owner signup start hidden.
--
-- account_type comes from the signup form's user metadata, so anyone can
-- sign up as a venue owner, and handle_new_user used to publish their venue
-- on the map immediately with whatever business name they typed. Now it's
-- created with is_hidden = true and goes live when an admin clicks "Show"
-- in pages/admin/venues.js (or toggles visibility in AdminEditPanel), the
-- same moderation path every other venue uses.
--
-- Everything else is identical to the current function, including the
-- empty search_path set by 20261110120100.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
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
    insert into public.venues (owner_id, name, category, city, phone, is_hidden)
    values (
      new.id,
      new.raw_user_meta_data->>'business_name',
      new.raw_user_meta_data->>'business_category',
      v_city,
      v_phone,
      true
    );
  end if;

  perform set_config('app.trusted_profile_write', 'false', true);
  return new;
end;
$$;

-- create or replace keeps the existing ACL, but restate it so this file is
-- correct on its own: trigger-only, never callable via /rest/v1/rpc.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
