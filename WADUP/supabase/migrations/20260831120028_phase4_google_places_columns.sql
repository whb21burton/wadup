alter table venues add column if not exists google_place_id text unique;
alter table venues add column if not exists google_rating float;
alter table venues add column if not exists google_review_count integer;
alter table venues add column if not exists source text default 'manual';
alter table venues add column if not exists hours jsonb;
alter table venues add column if not exists is_claimed boolean default false;
alter table venues add column if not exists cover_photo_url text;
