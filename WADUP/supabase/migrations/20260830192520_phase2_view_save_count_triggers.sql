-- Keep venues.view_count / save_count in sync with the activity tables via
-- SECURITY DEFINER triggers, so an anonymous visitor's venue_views insert
-- (or a user's saved_venues insert/delete) can bump a public counter on
-- `venues` without needing broad UPDATE grants on that table.

create or replace function bump_venue_view_count() returns trigger as $$
begin
  update venues set view_count = coalesce(view_count, 0) + 1 where id = new.venue_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_bump_venue_view_count on venue_views;
create trigger trg_bump_venue_view_count
after insert on venue_views
for each row execute function bump_venue_view_count();

create or replace function bump_venue_save_count() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update venues set save_count = coalesce(save_count, 0) + 1 where id = new.venue_id;
    return new;
  elsif tg_op = 'DELETE' then
    update venues set save_count = greatest(coalesce(save_count, 0) - 1, 0) where id = old.venue_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_bump_venue_save_count on saved_venues;
create trigger trg_bump_venue_save_count
after insert or delete on saved_venues
for each row execute function bump_venue_save_count();
