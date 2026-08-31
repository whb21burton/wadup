// pages/api/admin/_authAdmin.js — shared auth check for every /api/admin/*
// route. Exports no default handler, so — like pages/api/supabase-admin.js —
// Next.js still lists it as a route, but hitting it directly does nothing;
// it only exists to be imported by the other files in this directory.
import { supabaseAdmin } from '../supabase-admin';
import { getAdminRole } from '../../../lib/admin';

// Verifies the request's Bearer token and that the caller has *some*
// admin_roles entry. Returns { user, adminRole } or null. Route-specific
// scoping (isSuperAdmin / canAccessCity / canAccessState) is still each
// route's own responsibility on top of this.
export async function requireAdmin(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;

  const adminRole = await getAdminRole(supabaseAdmin, user.id);
  if (!adminRole) return null;

  return { user, adminRole };
}
