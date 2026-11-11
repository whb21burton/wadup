-- Record 20261110120000_lock_down_activity_and_stats_views as applied.
--
-- Its SQL was run on production directly (not via apply_migration / supabase
-- db push), so its grants and comments are live but
-- supabase_migrations.schema_migrations has no row for it. Verified
-- 2026-11-11: all five views' ACLs and comments match the file exactly.
--
-- Bookkeeping only — does not re-run the migration. Equivalent CLI command:
--   supabase migration repair --status applied 20261110120000
insert into supabase_migrations.schema_migrations (version, name)
select '20261110120000', 'lock_down_activity_and_stats_views'
where not exists (
  select 1 from supabase_migrations.schema_migrations where version = '20261110120000'
);
