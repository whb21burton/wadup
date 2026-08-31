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

  const { data: venue, error: fetchError } = await supabaseAdmin
    .from('venues').select('google_place_id, name').eq('id', venueId).single();
  if (fetchError || !venue) return res.status(404).json({ error: 'Venue not found' });

  // Record the delete in the permanent deleted_venues blocklist BEFORE
  // removing the row — /api/places/sync checks this table by google_place_id
  // so a deleted venue never gets silently re-inserted by the next sync.
  const { error: blocklistError } = await supabaseAdmin.from('deleted_venues').upsert(
    { google_place_id: venue.google_place_id, name: venue.name, deleted_by: auth.user.id },
    { onConflict: 'google_place_id' }
  );
  if (blocklistError) return res.status(500).json({ error: 'Failed to record deletion', detail: blocklistError.message });

  const { error } = await supabaseAdmin.from('venues').delete().eq('id', venueId);
  if (error) return res.status(500).json({ error: 'Delete failed', detail: error.message });

  return res.status(200).json({ success: true });
}
