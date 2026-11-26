-- Serialize quota accounting and tile claims. A failed upstream request still
-- consumes its reservation because Google may already have billed the call.
create index if not exists restaurant_coverage_runs_started_idx on public.restaurant_coverage_runs(started_at);
create index if not exists restaurant_coverage_tiles_region_status_idx on public.restaurant_coverage_tiles(region,status,id);

create or replace function public.reserve_places_discovery(p_tile_id bigint)
returns jsonb language plpgsql set search_path = '' as $$
declare
  checked_at timestamptz;
  active_month text;
  month_start timestamptz;
  slot_start timestamptz;
  snapshot public.google_usage_reports%rowtype;
  reported bigint;
  monthly bigint;
  slot_calls bigint;
  pending bigint;
  reservation bigint;
  category_cursor integer;
begin
  perform pg_advisory_xact_lock(412721, 1);
  checked_at := clock_timestamp();
  active_month := to_char(checked_at at time zone 'America/Los_Angeles', 'YYYY-MM');
  month_start := date_trunc('month', checked_at at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  slot_start := date_bin(interval '15 minutes', checked_at, '2000-01-01 00:00:00+00'::timestamptz);
  select s.* into snapshot from public.google_usage_reports s
  where s.billing_month = active_month
  order by s.covered_through desc, s.received_at desc limit 1;

  if snapshot.covered_through is null or snapshot.covered_through > checked_at or
     snapshot.covered_through <= checked_at - interval '72 hours' or
     snapshot.received_at <= checked_at - interval '6 hours' or
     jsonb_typeof(snapshot.units->'99F9-A108-83A6') is distinct from 'number' then
    return jsonb_build_object('status', 'google_budget_snapshot_unavailable');
  end if;
  select max((s.units->>'99F9-A108-83A6')::bigint) into reported
  from public.google_usage_reports s where s.billing_month = active_month;

  select coalesce(sum(api_calls), 0),
    coalesce(sum(api_calls) filter (where started_at >= slot_start), 0),
    coalesce(sum(api_calls) filter (where started_at >= snapshot.covered_through or status = 'running'), 0)
  into monthly, slot_calls, pending
  from public.restaurant_coverage_runs where started_at >= month_start;

  if reported + pending >= 4500 then
    return jsonb_build_object('status', 'google_budget_target_reached');
  elsif monthly >= 4500 then
    return jsonb_build_object('status', 'monthly_limit_reached');
  elsif slot_calls >= 2 then
    return jsonb_build_object('status', 'slot_limit_reached');
  end if;

  if exists (select 1 from public.restaurant_coverage_runs
    where started_at >= checked_at - interval '1 hour' and status='error'
      and error='Nearby Search access or quota rejected') then
    return jsonb_build_object('status', 'provider_cooldown');
  end if;

  update public.restaurant_coverage_tiles set status = 'running', started_at = checked_at
  where id = p_tile_id and status = 'queued'
    and attempts between 0 and 7
    and (last_error is null or started_at <= checked_at - interval '6 hours')
  returning attempts into category_cursor;
  if not found then return jsonb_build_object('status', 'tile_already_claimed'); end if;

  insert into public.restaurant_coverage_runs (tile_id, api_calls, started_at, status)
  values (p_tile_id, 1, checked_at, 'running') returning id into reservation;
  return jsonb_build_object('status', 'reserved', 'id', reservation, 'category_cursor', category_cursor);
end;
$$;

revoke all on function public.reserve_places_discovery(bigint) from public, anon, authenticated;
grant execute on function public.reserve_places_discovery(bigint) to service_role;

-- Keep only the identifier that Google exempts from caching restrictions.
create table if not exists public.google_places_candidate_ids (
  place_id text primary key,
  first_seen_at timestamptz not null default now()
);
alter table public.google_places_candidate_ids enable row level security;
revoke all on public.google_places_candidate_ids from public, anon, authenticated;
grant select, insert on public.google_places_candidate_ids to service_role;

create or replace function public.finish_places_discovery(p_run_id bigint, p_place_ids text[], p_error text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  job public.restaurant_coverage_runs%rowtype;
  tile public.restaurant_coverage_tiles%rowtype;
  added integer := 0;
  found_count integer := 0;
begin
  select * into job from public.restaurant_coverage_runs where id=p_run_id and status='running' for update;
  if not found then return jsonb_build_object('status','lease_lost'); end if;
  select * into tile from public.restaurant_coverage_tiles
    where id=job.tile_id and status='running' and started_at=job.started_at for update;
  if not found then return jsonb_build_object('status','lease_lost'); end if;

  if p_error is not null then
    update public.restaurant_coverage_tiles set status='queued',last_error=left(p_error,180) where id=tile.id;
    update public.restaurant_coverage_runs set status='error',error=left(p_error,180),finished_at=clock_timestamp() where id=job.id;
    return jsonb_build_object('status','retry_deferred');
  end if;

  if coalesce(cardinality(p_place_ids),0)>20 then raise exception 'Unexpected discovery result size'; end if;
  select count(distinct candidate.place_id) into found_count
  from unnest(p_place_ids) as candidate(place_id)
  where length(candidate.place_id)<=512 and candidate.place_id ~ '^[A-Za-z0-9_-]+$';
  insert into public.google_places_candidate_ids(place_id)
  select distinct candidate.place_id from unnest(p_place_ids) as candidate(place_id)
  where length(candidate.place_id)<=512 and candidate.place_id ~ '^[A-Za-z0-9_-]+$'
    and not exists (select 1 from public.venues where google_place_id=candidate.place_id)
    and not exists (select 1 from public.venues_pending where google_place_id=candidate.place_id)
    and not exists (select 1 from public.deleted_venues where google_place_id=candidate.place_id)
  on conflict do nothing;
  get diagnostics added = row_count;
  update public.restaurant_coverage_tiles set status=case when tile.attempts+1>=8 then 'done' else 'queued' end,
    attempts=tile.attempts+1,discovered=coalesce(tile.discovered,0)+found_count,
    completed_at=case when tile.attempts+1>=8 then clock_timestamp() end,last_error=null where id=tile.id;
  update public.restaurant_coverage_runs set status='done',discovered=found_count,staged=0,finished_at=clock_timestamp() where id=job.id;
  return jsonb_build_object('status','done','candidate_ids_added',added,'category_progress',tile.attempts+1);
end;
$$;
revoke all on function public.finish_places_discovery(bigint,text[],text) from public, anon, authenticated;
grant execute on function public.finish_places_discovery(bigint,text[],text) to service_role;

create or replace function public.read_google_usage_summary()
returns jsonb language sql stable set search_path = '' as $$
  with this_month as (
    select * from public.google_usage_reports
    where billing_month=to_char(now() at time zone 'America/Los_Angeles','YYYY-MM')
  ), latest as (
    select covered_through, received_at from this_month order by covered_through desc, received_at desc limit 1
  ), sku_totals as (
    select key, max(value::bigint) units from this_month cross join lateral jsonb_each_text(units) group by key
  )
  select jsonb_build_object(
    'covered_through',(select covered_through from latest),
    'received_at',(select received_at from latest),
    'units',(select jsonb_object_agg(key,units) from sku_totals),
    'outstanding',(select coalesce(sum(api_calls),0) from public.restaurant_coverage_runs
      where started_at >= (date_trunc('month',now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles')
        and (started_at >= (select covered_through from latest) or status='running')),
    'outstanding_skus',(select jsonb_object_agg(sku,amount) from (
      select sku,count(*) amount from public.google_api_reservations where reserved_at >= (select covered_through from latest) group by sku
    ) reservations),
    'candidate_ids',(select count(*) from public.google_places_candidate_ids)
  );
$$;
revoke all on function public.read_google_usage_summary() from public, anon, authenticated;
grant execute on function public.read_google_usage_summary() to service_role;
