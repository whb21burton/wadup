// pages/api/admin/reject-venue.js — marks a venues_pending row 'rejected'.
// The row is kept (not deleted) so /api/places/sync can recognize its
// google_place_id on a future run and skip it forever, the same way
// deleted_venues permanently blocks an already-live venue that got deleted.
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity } from '../../../lib/admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });

  const { pendingId } = req.body || {};
  if (!pendingId) return res.status(400).json({ error: 'Missing pendingId' });

  const { data: pending, error: fetchError } = await supabaseAdmin
    .from('venues_pending').select('city').eq('id', pendingId).single();
  if (fetchError || !pending) return res.status(404).json({ error: 'Pending venue not found' });
  if (!canAccessCity(auth.adminRole, pending.city)) {
    return res.status(403).json({ error: 'Not authorized for this city' });
  }

  const { error } = await supabaseAdmin.from('venues_pending').update({ status: 'rejected' }).eq('id', pendingId);
  if (error) return res.status(500).json({ error: 'Reject failed', detail: error.message });

  return res.status(200).json({ success: true });
}
