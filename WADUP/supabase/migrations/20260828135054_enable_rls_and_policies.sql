-- Enable RLS on all tables
alter table profiles enable row level security;
alter table venues enable row level security;
alter table reviews enable row level security;
alter table review_likes enable row level security;
alter table venue_events enable row level security;
alter table venue_schedule enable row level security;
alter table venue_photos enable row level security;
alter table points_log enable row level security;

-- ── profiles: read all (authenticated), edit own only ──
create policy "profiles_select_authenticated"
  on profiles for select
  to authenticated
  using (true);

create policy "profiles_insert_own"
  on profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── venues: public read, owner-only write ──
create policy "venues_select_public"
  on venues for select
  using (true);

create policy "venues_insert_owner"
  on venues for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy "venues_update_owner"
  on venues for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "venues_delete_owner"
  on venues for delete
  to authenticated
  using (auth.uid() = owner_id);

-- ── reviews: public read, author-only write ──
create policy "reviews_select_public"
  on reviews for select
  using (true);

create policy "reviews_insert_author"
  on reviews for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "reviews_update_author"
  on reviews for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reviews_delete_author"
  on reviews for delete
  to authenticated
  using (auth.uid() = user_id);

-- ── review_likes: insert/delete own only (no read policy requested) ──
create policy "review_likes_insert_own"
  on review_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "review_likes_delete_own"
  on review_likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- ── venue_events: public read, venue owner writes ──
create policy "venue_events_select_public"
  on venue_events for select
  using (true);

create policy "venue_events_insert_owner"
  on venue_events for insert
  to authenticated
  with check (
    exists (select 1 from venues v where v.id = venue_events.venue_id and v.owner_id = auth.uid())
  );

create policy "venue_events_update_owner"
  on venue_events for update
  to authenticated
  using (
    exists (select 1 from venues v where v.id = venue_events.venue_id and v.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from venues v where v.id = venue_events.venue_id and v.owner_id = auth.uid())
  );

create policy "venue_events_delete_owner"
  on venue_events for delete
  to authenticated
  using (
    exists (select 1 from venues v where v.id = venue_events.venue_id and v.owner_id = auth.uid())
  );

-- ── venue_schedule: public read, venue owner writes ──
create policy "venue_schedule_select_public"
  on venue_schedule for select
  using (true);

create policy "venue_schedule_insert_owner"
  on venue_schedule for insert
  to authenticated
  with check (
    exists (select 1 from venues v where v.id = venue_schedule.venue_id and v.owner_id = auth.uid())
  );

create policy "venue_schedule_update_owner"
  on venue_schedule for update
  to authenticated
  using (
    exists (select 1 from venues v where v.id = venue_schedule.venue_id and v.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from venues v where v.id = venue_schedule.venue_id and v.owner_id = auth.uid())
  );

create policy "venue_schedule_delete_owner"
  on venue_schedule for delete
  to authenticated
  using (
    exists (select 1 from venues v where v.id = venue_schedule.venue_id and v.owner_id = auth.uid())
  );

-- ── venue_photos: public read, uploader insert/delete only ──
create policy "venue_photos_select_public"
  on venue_photos for select
  using (true);

create policy "venue_photos_insert_own"
  on venue_photos for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "venue_photos_delete_own"
  on venue_photos for delete
  to authenticated
  using (auth.uid() = user_id);

-- ── points_log: read own only, no client-side insert (system/service_role only) ──
create policy "points_log_select_own"
  on points_log for select
  to authenticated
  using (auth.uid() = user_id);
