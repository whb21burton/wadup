create table if not exists checkins (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) not null,
  venue_id uuid references venues(id) not null,
  created_at timestamptz default now()
);
alter table checkins enable row level security;

create policy "checkins_insert_own"
  on checkins for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "checkins_select_own"
  on checkins for select
  to authenticated
  using (auth.uid() = user_id);

create table if not exists saved_venues (
  user_id uuid references profiles(id) not null,
  venue_id uuid references venues(id) not null,
  created_at timestamptz default now(),
  primary key (user_id, venue_id)
);
alter table saved_venues enable row level security;

create policy "saved_venues_select_own"
  on saved_venues for select
  to authenticated
  using (auth.uid() = user_id);

create policy "saved_venues_insert_own"
  on saved_venues for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "saved_venues_delete_own"
  on saved_venues for delete
  to authenticated
  using (auth.uid() = user_id);
