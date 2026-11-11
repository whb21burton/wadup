create table if not exists deleted_venues (
  id uuid default gen_random_uuid() primary key,
  google_place_id text unique,
  name text,
  deleted_by uuid references profiles(id),
  deleted_at timestamptz default now(),
  reason text
);
