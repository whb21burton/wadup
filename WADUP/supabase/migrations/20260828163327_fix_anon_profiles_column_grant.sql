-- The prior migration's column-level REVOKE was a no-op: anon held a
-- TABLE-level SELECT grant (Supabase's default), and revoking specific
-- columns from a role that never had a column-level grant does nothing —
-- the broader table-level grant still covers those columns. Verified live:
-- anon could still read profiles.email after the "fix". Correct approach is
-- to revoke the table-level grant entirely and grant SELECT on only the
-- safe columns instead.
revoke select on profiles from anon;
grant select (id, username, city, is_local, created_at) on profiles to anon;
