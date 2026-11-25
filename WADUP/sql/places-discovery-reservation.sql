-- Serialize quota accounting and tile claims. A failed upstream request still
-- consumes its reservation because Google may already have billed the call.
create or replace function public.reserve_places_discovery(p_tile_id bigint)
returns jsonb language plpgsql set search_path = '' as $$
declare
  checked_at timestamptz := clock_timestamp();
  billing_month text := to_char(checked_at at time zone 'America/Los_Angeles', 'YYYY-MM');
  month_start timestamptz := date_trunc('month', checked_at at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  day_start timestamptz := date_trunc('day', checked_at at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  snapshot public.google_api_budget_snapshots%rowtype;
  monthly bigint;
  daily bigint;
  pending bigint;
  reservation bigint;
begin
  perform pg_advisory_xact_lock(412721, 1);
  select s.* into snapshot from public.google_api_budget_snapshots s
  where s.month_utc = billing_month
    and s.sku = 'nearby_search_pro' and s.source = 'google_cloud'
  order by s.captured_at desc, s.id desc limit 1;

  if snapshot.captured_at is null or snapshot.captured_at > checked_at or
     snapshot.captured_at <= checked_at - interval '6 hours' or snapshot.requests < 0 then
    return jsonb_build_object('status', 'google_budget_snapshot_unavailable');
  end if;

  select coalesce(sum(api_calls), 0),
    coalesce(sum(api_calls) filter (where started_at >= day_start), 0),
    coalesce(sum(api_calls) filter (where started_at >= snapshot.captured_at), 0)
  into monthly, daily, pending
  from public.restaurant_coverage_runs where started_at >= month_start;

  if snapshot.requests + pending >= 4500 then
    return jsonb_build_object('status', 'google_budget_target_reached');
  elsif monthly >= 250 then
    return jsonb_build_object('status', 'monthly_limit_reached');
  elsif daily >= 8 then
    return jsonb_build_object('status', 'daily_limit_reached');
  end if;

  update public.restaurant_coverage_tiles set status = 'running', started_at = checked_at
  where id = p_tile_id and status = 'queued';
  if not found then return jsonb_build_object('status', 'tile_already_claimed'); end if;

  insert into public.restaurant_coverage_runs (tile_id, api_calls, started_at)
  values (p_tile_id, 1, checked_at) returning id into reservation;
  return jsonb_build_object('status', 'reserved', 'id', reservation);
end;
$$;

revoke all on function public.reserve_places_discovery(bigint) from public, anon, authenticated;
grant execute on function public.reserve_places_discovery(bigint) to service_role;
