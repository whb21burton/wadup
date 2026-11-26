-- Disposable local Auth fixture. Never apply to a hosted project.
create table public.profiles (
  id uuid primary key references auth.users(id), username text not null, city text,
  is_local boolean not null default true, account_type text not null default 'user',
  is_suspended boolean not null default false
);
create function public.create_fixture_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,username,city)
    values(new.id,new.raw_user_meta_data->>'username',new.raw_user_meta_data->>'city');
  return new;
end;
$$;
revoke all on function public.create_fixture_profile() from public, anon, authenticated;
create trigger fixture_profile_after_signup after insert on auth.users
  for each row execute function public.create_fixture_profile();

create table public.venues (
  id uuid primary key, name text not null, category text, categories text[],
  subcategory text, subcategories text[], address text, city text, state text,
  lat double precision, lng double precision, is_hidden boolean default false,
  average_rating numeric, total_ratings integer, weighted_rating numeric,
  weighted_rating_count integer, subcategory_weighted_ratings jsonb,
  admin_rating numeric, google_rating numeric, google_review_count integer,
  cover_photo_url text, view_count integer, save_count integer, current_flame integer
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  venue_id uuid not null references public.venues(id), overall_rating numeric not null,
  subcategory_ratings jsonb, content text, created_at timestamptz default now(),
  unique(user_id,venue_id)
);
create table public.admin_roles (user_id uuid references public.profiles(id), role text);
create table public.venue_events (venue_id uuid, start_time timestamp, end_time timestamp);
create table public.venue_schedule (venue_id uuid, day_of_week integer);
create table public.venue_flames (id uuid default gen_random_uuid(), venue_id uuid, vote_date date, user_id uuid);
create table public.venue_views (venue_id uuid, user_id uuid);
create table public.saved_venues (venue_id uuid, user_id uuid);
create table public.checkins (venue_id uuid, user_id uuid);

alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.reviews enable row level security;
alter table public.admin_roles enable row level security;
alter table public.venue_views enable row level security;
create policy fixture_profile_read on public.profiles for select using (true);
create policy fixture_venue_read on public.venues for select using (not is_hidden);
create policy fixture_review_read on public.reviews for select using (true);
create policy fixture_view_insert on public.venue_views for insert with check (user_id is null or user_id = auth.uid());
grant select on public.profiles,public.venues,public.reviews,public.venue_events,public.venue_schedule,
 public.venue_flames,public.saved_venues,public.checkins,public.admin_roles to anon,authenticated;
grant insert on public.venue_views to anon,authenticated;
grant all on all tables in schema public to service_role;

insert into public.venues(id,name,category,categories,subcategory,subcategories,city,state,lat,lng)
values('003e0534-cfa3-4b7e-9aaa-70c56e5e5bb7','Fixture Local Kitchen','restaurant','{restaurant}','pizza','{pizza}',
 'Chattanooga','TN',35.0456,-85.3096);
