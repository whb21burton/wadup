-- set_config(name, value, is_local=true) scopes to the whole transaction, not
-- just the current statement. Any trigger that sets a trusted-write flag and
-- never clears it will leak that trust to every later statement in the same
-- transaction. In practice each PostgREST request is its own transaction, so
-- this was low-risk, but it's fragile to rely on that — reset explicitly.

create or replace function public.sync_review_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.trusted_review_write', 'true', true);
  if TG_OP = 'INSERT' then
    update reviews set likes = likes + 1 where id = new.review_id;
  elsif TG_OP = 'DELETE' then
    update reviews set likes = greatest(likes - 1, 0) where id = old.review_id;
  end if;
  perform set_config('app.trusted_review_write', 'false', true);
  return null;
end;
$$;

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

  perform set_config('app.trusted_profile_write', 'false', true);
  return new;
end;
$$;
