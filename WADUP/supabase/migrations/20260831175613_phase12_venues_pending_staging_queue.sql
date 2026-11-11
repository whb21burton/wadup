create table if not exists venues_pending (
  id uuid default gen_random_uuid() primary key,
  google_place_id text unique,
  name text not null,
  category text,
  categories text[],
  subcategory text,
  address text,
  city text,
  state text,
  lat float,
  lng float,
  phone text,
  website text,
  google_rating float,
  google_review_count integer,
  cover_photo_url text,
  hours jsonb,
  source text default 'google_places',
  submitted_at timestamptz default now(),
  status text default 'pending'
);

alter table venues_pending enable row level security;

alter table venues add column if not exists hide_new_badge boolean default false;

-- Fixed alongside this migration: deleted_venues shipped last session without
-- RLS enabled, which the Supabase linter flags as ERROR (a public table with
-- no RLS is readable/writable by the anon/authenticated grants by default).
-- Every access to it goes through supabaseAdmin (service role, bypasses RLS
-- anyway), so enabling RLS with zero policies only closes the accidental
-- public hole without changing any real app behavior.
alter table deleted_venues enable row level security;
