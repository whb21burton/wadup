-- Two profiles triggers reference wadup_points directly in plpgsql (new.wadup_points
-- := ...). Dropping the column while these functions still reference it would break
-- EVERY future write to profiles (signup, edits, everything) with "record has no
-- field wadup_points" — fix the functions first, in the same migration.
create or replace function public.enforce_profile_defaults_on_insert()
returns trigger
language plpgsql
as $$
begin
  if auth.role() is distinct from 'service_role'
     and coalesce(current_setting('app.trusted_profile_write', true), '') <> 'true' then
    new.account_type := 'user';
  end if;
  return new;
end;
$$;

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() is distinct from 'service_role'
     and coalesce(current_setting('app.trusted_profile_write', true), '') <> 'true' then
    new.account_type := old.account_type;
  end if;
  return new;
end;
$$;

-- recalculate_vote_score() only exists to be triggered from venue_votes and
-- references venues.vote_score directly — both are being dropped below, so
-- drop this function explicitly too rather than leave it as orphaned dead code
-- referencing columns that no longer exist.
drop function if exists public.recalculate_vote_score() cascade;

-- Drop old vote system
drop table if exists venue_votes cascade;
alter table venues drop column if exists vote_score;
alter table venues drop column if exists admin_rank_override;

-- Update reviews table for new 1-10 rating system
alter table reviews drop column if exists rating;
alter table reviews add column if not exists overall_rating numeric(3,1) check (overall_rating >= 1 and overall_rating <= 10);
alter table reviews add column if not exists subcategory_ratings jsonb default '{}';

-- Add weighted rating columns to venues, plus custom subcategories (item 9)
alter table venues add column if not exists weighted_rating numeric(4,2) default 0;
alter table venues add column if not exists weighted_rating_count integer default 0;
alter table venues add column if not exists subcategory_weighted_ratings jsonb default '{}';
alter table venues add column if not exists custom_subcategories text[] default '{}';

-- Remove points system
alter table profiles drop column if exists wadup_points;
drop table if exists points_log cascade;
drop table if exists user_badges cascade;
