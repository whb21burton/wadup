// pages/api/admin/hide-venue.js — soft-deletes a venue (sets is_hidden=true,
// never actually deletes the row). Most venues have no owner (owner_id is
// null for everything Google Places-sourced), so the regular
// venues_update_owner RLS policy could never let anyone fix a bad listing —
// this needs the same admin-password + service-role pattern as places/sync.
import { supabaseAdmin } from '../supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ADMIN_SYNC_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_SYNC_PASSWORD is not configured on the server' });
  }
  if (req.headers['x-admin-password'] !== process.env.ADMIN_SYNC_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }

  const { venueId } = req.body || {};
  if (!venueId) return res.status(400).json({ error: 'Missing venueId' });

  const { error } = await supabaseAdmin.from('venues').update({ is_hidden: true }).eq('id', venueId);
  if (error) return res.status(500).json({ error: 'Hide failed', detail: error.message });

  return res.status(200).json({ success: true });
}
