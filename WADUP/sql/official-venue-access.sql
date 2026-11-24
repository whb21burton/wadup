revoke all on public.official_venue_performances,public.official_venue_sync_status from public,anon,authenticated;
grant select,insert,update,delete on public.official_venue_performances,public.official_venue_sync_status to service_role;
create index if not exists official_venue_performances_date_idx on public.official_venue_performances(local_date);
