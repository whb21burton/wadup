// pages/api/admin/delete-venue.js — permanently removes a venue row.
// Super admin only: an ambassador can hide a bad listing (reversible by a
// super admin later), but a real, irreversible delete is reserved for the
// higher trust tier.
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

  const { venueId } = req.body || {};
  if (!venueId) return res.status(400).json({ error: 'Missing venueId' });

  const { error } = await supabaseAdmin.from('venues').delete().eq('id', venueId);
  if (error) return res.status(500).json({ error: 'Delete failed', detail: error.message });

  return res.status(200).json({ success: true });
}
