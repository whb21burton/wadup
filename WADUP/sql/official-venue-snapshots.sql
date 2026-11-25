alter table public.official_venue_sync_status
  add column if not exists last_complete_at timestamptz;

create or replace function public.write_official_venue_snapshot(
  p_venue text, p_checked_at timestamptz, p_status text, p_reason text,
  p_rows jsonb, p_complete boolean
) returns void language plpgsql set search_path = '' as $$
declare
  row_count integer := jsonb_array_length(p_rows);
begin
  insert into public.official_venue_sync_status as sync_status
    (venue_id, status, reason, checked_at, performance_count, last_complete_at)
  values (p_venue, p_status, p_reason, p_checked_at, row_count,
    case when p_complete and row_count > 0 then p_checked_at end)
  on conflict (venue_id) do update set
    status = excluded.status, reason = excluded.reason, checked_at = excluded.checked_at,
    performance_count = excluded.performance_count,
    last_complete_at = coalesce(excluded.last_complete_at, sync_status.last_complete_at)
  where sync_status.checked_at < excluded.checked_at;
  if not found then return; end if;

  insert into public.official_venue_performances as performances
    (venue_id, performance_key, name, local_date, local_time, official_url, last_seen_at)
  select p_venue, entry.performance_key, entry.name, entry.local_date, entry.local_time,
    entry.official_url, p_checked_at
  from jsonb_to_recordset(p_rows) as entry(
    performance_key text, name text, local_date date, local_time time, official_url text
  )
  on conflict (venue_id, performance_key) do update set
    name = excluded.name, official_url = excluded.official_url, last_seen_at = excluded.last_seen_at
  where performances.last_seen_at <= excluded.last_seen_at;
end;
$$;

revoke all on function public.write_official_venue_snapshot(text,timestamptz,text,text,jsonb,boolean)
  from public, anon, authenticated;
grant execute on function public.write_official_venue_snapshot(text,timestamptz,text,text,jsonb,boolean)
  to service_role;

create index if not exists official_venue_performances_date_cursor_idx
  on public.official_venue_performances (local_date, venue_id, performance_key);

create or replace function public.read_official_venue_performances(
  p_date date, p_after_venue text default '', p_after_key text default ''
) returns table (venue_id text, performance_key text, name text, local_date date,
  local_time time, official_url text, last_seen_at timestamptz)
language sql stable set search_path = '' as $$
  select p.venue_id, p.performance_key, p.name, p.local_date, p.local_time, p.official_url, p.last_seen_at
  from public.official_venue_performances p
  left join public.official_venue_sync_status s on s.venue_id = p.venue_id
  where p.local_date = p_date
    and (p.venue_id, p.performance_key) > (p_after_venue, p_after_key)
    and p.last_seen_at >= now() - interval '7 days'
    and (s.last_complete_at is null or p.last_seen_at >= s.last_complete_at)
  order by p.venue_id, p.performance_key
  limit 250;
$$;

revoke all on function public.read_official_venue_performances(date,text,text)
  from public, anon, authenticated;
grant execute on function public.read_official_venue_performances(date,text,text)
  to service_role;
