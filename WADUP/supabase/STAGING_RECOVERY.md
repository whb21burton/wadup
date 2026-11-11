# Wadup database migration recovery and staging

## Recovered history (2026-11-11)
- 34 original SQL statements were recovered from `supabase_migrations.schema_migrations.statements[1]` on production and committed to this feature branch in chronological order.
- Security migrations 20261110120000 through 20261111120200 are also in this directory.
- Migration 20261110120000 was executed previously on production and its history row was subsequently repaired. Do not reapply it to production.
- Production remains the source of truth. Do not use `supabase db reset` or `supabase db push` against production.

## Fresh-branch issue
- A prior paid Supabase development branch reached `MIGRATIONS_FAILED` after applying only the first 17 historical migrations. Its exact error log was not recovered.
- Migration `20260831132015_phase6_admin_roles.sql` contains a hard-coded production profile UUID for the super-admin seed. Fresh Supabase branches do not copy auth/profile data; inserting the seed directly violates the foreign key when the profile is absent.
- The version committed in GitHub now guards that seed with `INSERT ... SELECT ... FROM profiles WHERE id = ...`.
- **Important:** Supabase-managed branching replays migration statements retained in the production migration history, not necessarily these edited GitHub files. Updating this repository alone does NOT guarantee a managed branch will initialize. Do not create another billed branch until the migration source for branching is confirmed and the seed issue is resolved there.

## Recommended safe test sequence
1. Inspect the Supabase branching migration source and failed-branch logs (if available). Verify that the admin seed is the failure.
2. Resolve the seed for managed branch creation using an approved, production-safe migration-history repair or a migration-based staging workflow that uses the GitHub SQL.
3. Explicitly approve the quoted hourly cost before creating a new temporary branch.
4. Confirm all 34 historical migrations and Migration 1 are present on staging; verify tables, views, policies, functions, and constraints.
5. Apply security migrations 2–6 in order on staging, with frontend deployment preceding migration 4. Run role-matrix and signup/suspension/admin tests with synthetic users.
6. Connect Vercel preview to staging-only URL and keys, redeploy, test, and remove staging credentials.
7. Delete the temporary Supabase branch promptly and verify it is absent from `list_branches`. Do not merge into production without separate validation.

## Production rollout caution
Migration 4 removes broad profile SELECT privileges and requires updated frontend code to be live first. No production deployment of migrations 2–6 is authorized by this recovery task.
