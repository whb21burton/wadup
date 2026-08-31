// pages/api/admin/hide-venue.js — soft-deletes a venue (sets is_hidden=true,
// never actually deletes the row). Most venues have no owner (owner_id is
// null for everything Google Places-sourced), so the regular
// venues_update_owner RLS policy could never let anyone fix a bad listing —
// this goes through the service-role client, gated on a real admin_roles
// entry (super_admin, or an ambassador scoped to this venue's city).
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

  const { venueId } = req.body || {};
  if (!venueId) return res.status(400).json({ error: 'Missing venueId' });

  const { data: venue, error: fetchError } = await supabaseAdmin
    .from('venues').select('city').eq('id', venueId).single();
  if (fetchError || !venue) return res.status(404).json({ error: 'Venue not found' });
  if (!canAccessCity(auth.adminRole, venue.city)) {
    return res.status(403).json({ error: 'Not authorized for this city' });
  }

  const { error } = await supabaseAdmin.from('venues').update({ is_hidden: true }).eq('id', venueId);
  if (error) return res.status(500).json({ error: 'Hide failed', detail: error.message });

  return res.status(200).json({ success: true });
}
