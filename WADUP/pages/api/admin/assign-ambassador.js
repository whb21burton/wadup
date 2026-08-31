// pages/api/admin/assign-ambassador.js — assign/remove the ambassador role.
// Super admin only; admin_roles has no client write policy at all.
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { isSuperAdmin } from '../../../lib/admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });
  if (!isSuperAdmin(auth.adminRole)) return res.status(403).json({ error: 'Super admin only' });

  const { action, userId, cities, states } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  if (action === 'remove') {
    // Guard: this route only ever manages ambassadors, never super admins.
    const { error } = await supabaseAdmin
      .from('admin_roles').delete().eq('user_id', userId).neq('role', 'super_admin');
    if (error) return res.status(500).json({ error: 'Remove failed', detail: error.message });
    return res.status(200).json({ success: true });
  }

  const { error } = await supabaseAdmin.from('admin_roles').upsert({
    user_id: userId,
    role: 'ambassador',
    assigned_cities: Array.isArray(cities) ? cities : [],
    assigned_states: Array.isArray(states) ? states : [],
  }, { onConflict: 'user_id' });
  if (error) return res.status(500).json({ error: 'Assign failed', detail: error.message });

  return res.status(200).json({ success: true });
}
