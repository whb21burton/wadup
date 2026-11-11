-- Votes table
create table if not exists venue_votes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade,
  venue_id uuid references venues(id) on delete cascade,
  category text not null,
  vote integer not null check (vote in (1, -1)),
  weight integer not null,
  created_at timestamptz default now(),
  unique(user_id, venue_id, category)
);

create index if not exists venue_votes_venue_id_idx on venue_votes(venue_id);

alter table venue_votes enable row level security;

drop policy if exists "public read votes" on venue_votes;
create policy "public read votes" on venue_votes for select using (true);

drop policy if exists "users manage own votes" on venue_votes;
create policy "users manage own votes" on venue_votes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table venues add column if not exists vote_score integer default 0;
alter table venues add column if not exists admin_rank_override jsonb default '{}';

-- Named venue_event_schedule (not venue_schedule, per the task's literal SQL)
-- because venue_schedule already exists with a different, incompatible shape
-- (one row per day_of_week with has_live_music/has_trivia/has_happy_hour/
-- has_specials booleans + a single happy_hour_start/end pair) that
-- pages/venue/[id].js's Hours section and lib/badges.js's music_checkins
-- calculation both depend on. This is the new one-row-per-event schedule
-- the trending calculation needs (multiple distinct timed events per day).
create table if not exists venue_event_schedule (
  id uuid default gen_random_uuid() primary key,
  venue_id uuid references venues(id) on delete cascade,
  day_of_week integer check (day_of_week between 0 and 6), -- 0=Sun, 6=Sat
  event_type text, -- 'live_music','trivia','happy_hour','specials','activities'
  start_time time not null,
  end_time time not null,
  description text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists venue_event_schedule_lookup_idx on venue_event_schedule(day_of_week, is_active);

alter table venue_event_schedule enable row level security;

drop policy if exists "public read schedule" on venue_event_schedule;
create policy "public read schedule" on venue_event_schedule for select using (true);

drop policy if exists "owner manage schedule" on venue_event_schedule;
create policy "owner manage schedule" on venue_event_schedule for all
  using (exists (select 1 from venues v where v.id = venue_id and v.owner_id = auth.uid()))
  with check (exists (select 1 from venues v where v.id = venue_id and v.owner_id = auth.uid()));

-- Trigger to recalculate vote_score when votes change
create or replace function recalculate_vote_score()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update venues set vote_score = (
    select coalesce(sum(vote * weight), 0)
    from venue_votes where venue_id = coalesce(new.venue_id, old.venue_id)
  ) where id = coalesce(new.venue_id, old.venue_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists update_vote_score on venue_votes;
create trigger update_vote_score
after insert or update or delete on venue_votes
for each row execute function recalculate_vote_score();
