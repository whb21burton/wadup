create table if not exists public.official_venue_performances (
 venue_id text not null,
 performance_key text not null,
 name text not null,
 local_date date not null,
 local_time time not null,
 official_url text not null,
 last_seen_at timestamptz not null default now(),
 primary key (venue_id,performance_key)
);
alter table public.official_venue_performances enable row level security;
create table if not exists public.official_venue_sync_status (
 venue_id text primary key,
 status text not null,
 reason text,
 checked_at timestamptz not null default now(),
 performance_count integer not null default 0
);
alter table public.official_venue_sync_status enable row level security;
