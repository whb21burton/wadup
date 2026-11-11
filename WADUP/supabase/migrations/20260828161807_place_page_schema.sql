-- venues: fields needed for the place page header/about section
alter table venues
  add column if not exists description text,
  add column if not exists cover_photo_url text,
  add column if not exists social_links jsonb default '{}'::jsonb;

-- reviews: tags, photos, and a business-owner response slot
alter table reviews
  add column if not exists tags text[] default '{}'::text[],
  add column if not exists photo_urls text[] default '{}'::text[],
  add column if not exists business_response text,
  add column if not exists business_response_at timestamptz;

-- Protect reviews.likes from direct client tampering by the review's own
-- author (who otherwise has full UPDATE rights on their row) — mirrors the
-- profiles wadup_points/account_type guard pattern already in place.
create or replace function public.protect_review_likes_column()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.trusted_review_write', true), '') <> 'true' then
    new.likes := old.likes;
  end if;
  return new;
end;
$$;

create trigger protect_review_likes_column
  before update on reviews
  for each row execute function protect_review_likes_column();

-- review_likes SELECT is scoped to the caller's own rows only (RLS), so a
-- client can never compute an accurate "helpful" count via a direct query.
-- Keep reviews.likes as the public, denormalized counter instead.
create or replace function public.sync_review_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.trusted_review_write', 'true', true);
  if TG_OP = 'INSERT' then
    update reviews set likes = likes + 1 where id = new.review_id;
  elsif TG_OP = 'DELETE' then
    update reviews set likes = greatest(likes - 1, 0) where id = old.review_id;
  end if;
  return null;
end;
$$;

create trigger review_likes_sync_insert
  after insert on review_likes
  for each row execute function sync_review_likes_count();

create trigger review_likes_sync_delete
  after delete on review_likes
  for each row execute function sync_review_likes_count();

-- Lightweight review reporting
create table if not exists review_reports (
  id uuid default gen_random_uuid() primary key,
  review_id uuid references reviews(id) not null,
  reporter_id uuid references profiles(id) not null,
  reason text,
  created_at timestamptz default now()
);
alter table review_reports enable row level security;

create policy "review_reports_insert_own"
  on review_reports for insert
  to authenticated
  with check (auth.uid() = reporter_id);

create policy "review_reports_select_own"
  on review_reports for select
  to authenticated
  using (auth.uid() = reporter_id);

-- Storage bucket for review photo uploads
insert into storage.buckets (id, name, public)
values ('review-photos', 'review-photos', true)
on conflict (id) do nothing;

create policy "review_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'review-photos');

create policy "review_photos_own_upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'review-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
