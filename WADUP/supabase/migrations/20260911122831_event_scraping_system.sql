alter table venues add column if not exists scraping_enabled boolean default false;
alter table venues add column if not exists scraping_url text;
alter table venues add column if not exists last_scraped_at timestamptz;
alter table venues add column if not exists scraping_notes text;

-- venue_events needs a `source` column (the scraper writes 'scraped') and a
-- unique constraint on (venue_id, start_time) so re-scraping the same event
-- can upsert instead of creating a duplicate calendar entry — neither existed
-- before this migration, and the cron job's upsert() call requires both.
alter table venue_events add column if not exists source text default 'manual';
alter table venue_events add constraint venue_events_venue_start_unique unique (venue_id, start_time);

create table if not exists scraped_events_pending (
  id uuid default gen_random_uuid() primary key,
  venue_id uuid references venues(id) on delete cascade,
  venue_name text,
  event_name text,
  event_date date,
  event_time time,
  performer text,
  event_type text,
  description text,
  confidence integer,
  raw_text text,
  source_url text,
  status text default 'pending',
  scraped_at timestamptz default now()
);

alter table scraped_events_pending enable row level security;

drop policy if exists "admin only" on scraped_events_pending;
create policy "admin only" on scraped_events_pending for all using (
  exists (select 1 from admin_roles where user_id = auth.uid())
);
