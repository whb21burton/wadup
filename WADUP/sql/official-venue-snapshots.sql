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
