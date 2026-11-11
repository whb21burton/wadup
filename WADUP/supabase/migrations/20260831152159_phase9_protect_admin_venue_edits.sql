alter table venues add column if not exists last_google_sync timestamptz;
alter table venues add column if not exists custom_cover_photo boolean default false;
