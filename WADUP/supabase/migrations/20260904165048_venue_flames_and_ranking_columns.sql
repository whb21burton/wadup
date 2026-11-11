create table if not exists venue_flames (
  id uuid default gen_random_uuid() primary key,
  venue_id uuid references venues(id) on delete cascade,
  flame_level integer check (flame_level in (1, 2, 3)),
  user_id uuid references profiles(id) null,
  ip_hash text,
  weight integer default 1,
  vote_date date default current_date,
  created_at timestamptz default now()
);

alter table venue_flames enable row level security;

drop policy if exists "anyone can insert flames" on venue_flames;
create policy "anyone can insert flames" on venue_flames for insert with check (true);

drop policy if exists "public read flames" on venue_flames;
create policy "public read flames" on venue_flames for select using (true);

-- Guards against duplicate votes from the same signed-in user or the same
-- anonymous IP on the same venue on the same day; the flame API does a
-- select-then-insert/update rather than relying on ON CONFLICT against these
-- (partial indexes aren't reliably addressable via the supabase-js upsert
-- onConflict param), but they still protect against a concurrent double-vote.
create unique index if not exists venue_flames_user_vote_idx
  on venue_flames (venue_id, user_id, vote_date) where user_id is not null;
create unique index if not exists venue_flames_ip_vote_idx
  on venue_flames (venue_id, ip_hash, vote_date) where user_id is null and ip_hash is not null;

alter table venues add column if not exists current_flame integer default 0;
alter table venues add column if not exists google_reviews jsonb default '[]';
alter table venues add column if not exists google_photo_refs jsonb default '[]';
alter table venues add column if not exists admin_rank_number integer;
