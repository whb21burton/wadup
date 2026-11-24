-- Apply before enabling TICKET_VERIFY_ENABLED. Existing readers remain compatible.
alter table public.tm_events_cache add column if not exists ticket_verification jsonb;
alter table public.tm_events_cache add column if not exists ticket_sales jsonb;
-- No changes to RLS, existing event records, or grants.
