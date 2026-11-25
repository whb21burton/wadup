create table if not exists public.google_usage_reports (
  batch_id text primary key,
  billing_month text not null,
  covered_through timestamptz not null,
  received_at timestamptz not null default now(),
  units jsonb not null check (jsonb_typeof(units) = 'object')
);
create index if not exists google_usage_reports_month_cutoff_idx
  on public.google_usage_reports(billing_month, covered_through desc, received_at desc);
alter table public.google_usage_reports enable row level security;
revoke all on public.google_usage_reports from public, anon, authenticated;
grant select, insert on public.google_usage_reports to service_role;

create table if not exists public.google_api_reservations (
  id bigint generated always as identity primary key,
  sku text not null,
  reserved_at timestamptz not null default clock_timestamp()
);
create index if not exists google_api_reservations_sku_time_idx on public.google_api_reservations(sku,reserved_at);
alter table public.google_api_reservations enable row level security;
revoke all on public.google_api_reservations from public, anon, authenticated;
grant select,insert on public.google_api_reservations to service_role;

create or replace function public.reserve_google_api_use(p_sku text)
returns boolean language plpgsql set search_path = '' as $$
declare
  checked_at timestamptz := clock_timestamp();
  month_key text := to_char(checked_at at time zone 'America/Los_Angeles','YYYY-MM');
  snapshot public.google_usage_reports%rowtype;
  allowed integer;
  reported bigint;
  pending bigint;
begin
  -- Nearby Search Pro is guarded separately by the tile reservation worker.
  allowed := case p_sku
    when 'FAF4-3B2D-51B2' then 9000 -- Dynamic Maps
    when 'BAC8-4E68-E261' then 9000 -- Geocoding
    when '772E-9975-BE34' then 900 -- Nearby Search Enterprise
    when 'E967-44BC-B44D' then 900 -- Text Search Enterprise
    when 'EB23-5ECC-0EF7' then 900 -- Place Details Enterprise + Atmosphere
    when 'DCD1-FE97-8C71' then 900 -- Place Details Photos
    else 0 end;
  if allowed=0 then return false; end if;
  perform pg_advisory_xact_lock(412721, hashtext(p_sku));
  select * into snapshot from public.google_usage_reports where billing_month=month_key
    order by covered_through desc,received_at desc limit 1;
  if snapshot.covered_through is null or snapshot.covered_through>checked_at or
     snapshot.covered_through<=checked_at-interval '72 hours' or snapshot.received_at<=checked_at-interval '6 hours' or
     jsonb_typeof(snapshot.units->p_sku) is distinct from 'number' then return false; end if;
  select max((units->>p_sku)::bigint) into reported from public.google_usage_reports where billing_month=month_key;
  select count(*) into pending from public.google_api_reservations where sku=p_sku and reserved_at>=snapshot.covered_through;
  if reported is null or reported+pending>=allowed then return false; end if;
  insert into public.google_api_reservations(sku,reserved_at) values(p_sku,checked_at);
  return true;
end;
$$;
revoke all on function public.reserve_google_api_use(text) from public, anon, authenticated;
grant execute on function public.reserve_google_api_use(text) to service_role;
