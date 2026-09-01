// Server-only Supabase client authenticated with the service role key — it
// bypasses RLS entirely, so this file must never be imported by client-side
// code (only from other pages/api/*.js routes, which Next.js never bundles
// into the browser). It's used for writes that the DB deliberately locks
// out of the regular anon/authenticated roles — e.g. profiles.account_type is
// protected by a trigger that silently reverts the write unless
// auth.role() = 'service_role' — and for reads that need to see across every
// user's row (lib/rankings.js's recalculateVenueRating reads every
// reviewer's profile/admin_roles row to weight their rating, which their own
// session's RLS wouldn't allow).
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
