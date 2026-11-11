create table if not exists tm_events_cache (
  id uuid default gen_random_uuid() primary key,
  tm_id text unique not null,
  name text not null,
  segment text,
  genre text,
  sub_genre text,
  cat text,
  sport_emoji text,
  date_str text,
  time_str text,
  lat float,
  lng float,
  venue_name text,
  city text,
  state text,
  address text,
  price text,
  url text,
  image_url text,
  cached_at timestamptz default now()
);

create index if not exists tm_events_cache_lat_lng on tm_events_cache(lat, lng);
create index if not exists tm_events_cache_date on tm_events_cache(date_str);

alter table tm_events_cache enable row level security;

drop policy if exists "public read tm cache" on tm_events_cache;
create policy "public read tm cache" on tm_events_cache for select using (true);
