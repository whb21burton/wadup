-- Users profile table
create table profiles (
  id uuid references auth.users primary key,
  username text unique not null,
  email text,
  phone text,
  city text,
  is_local boolean default false,
  wadup_points integer default 0,
  account_type text default 'user',
  created_at timestamp default now()
);

-- Venues table
create table venues (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references profiles(id),
  name text not null,
  category text,
  subcategory text,
  address text,
  city text,
  state text,
  lat float,
  lng float,
  phone text,
  website text,
  is_verified boolean default false,
  is_local_favorite boolean default false,
  average_rating float default 0,
  total_ratings integer default 0,
  created_at timestamp default now()
);

-- Reviews table
create table reviews (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id),
  venue_id uuid references venues(id),
  rating integer check (rating >= 1 and rating <= 5),
  content text,
  likes integer default 0,
  is_local boolean default false,
  created_at timestamp default now(),
  unique(user_id, venue_id)
);

-- Review likes table
create table review_likes (
  user_id uuid references profiles(id),
  review_id uuid references reviews(id),
  primary key (user_id, review_id)
);

-- Venue events table
create table venue_events (
  id uuid default gen_random_uuid() primary key,
  venue_id uuid references venues(id),
  title text not null,
  description text,
  event_type text, -- 'live_music', 'trivia', 'specials', 'happy_hour'
  start_time timestamp,
  end_time timestamp,
  is_free boolean default false,
  ticket_url text,
  created_at timestamp default now()
);

-- Venue schedule table
create table venue_schedule (
  id uuid default gen_random_uuid() primary key,
  venue_id uuid references venues(id),
  day_of_week integer, -- 0=Sunday, 6=Saturday
  open_time time,
  close_time time,
  has_live_music boolean default false,
  has_trivia boolean default false,
  has_specials boolean default false,
  has_happy_hour boolean default false,
  happy_hour_start time,
  happy_hour_end time
);

-- Photos table
create table venue_photos (
  id uuid default gen_random_uuid() primary key,
  venue_id uuid references venues(id),
  user_id uuid references profiles(id),
  url text not null,
  caption text,
  likes integer default 0,
  created_at timestamp default now()
);

-- Points log
create table points_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id),
  points integer,
  reason text,
  created_at timestamp default now()
);
