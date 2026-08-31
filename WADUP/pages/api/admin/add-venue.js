// pages/api/admin/add-venue.js — adds a venue, either typed in manually or
// pre-filled from a Google Places search result on the client (both arrive
// here as the same plain venue-shaped object, so this route doesn't need to
// know or care which path it came from).
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity } from '../../../lib/admin';

const ALLOWED_FIELDS = [
  'name', 'address', 'city', 'state', 'lat', 'lng', 'phone', 'website',
  'category', 'subcategory', 'custom_emoji',
  'google_place_id', 'google_rating', 'google_review_count', 'cover_photo_url', 'hours', 'source',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });

  const { venue } = req.body || {};
  if (!venue?.name || !venue?.city || !venue?.category) {
    return res.status(400).json({ error: 'name, city, and category are required' });
  }
  if (!canAccessCity(auth.adminRole, venue.city)) {
    return res.status(403).json({ error: 'Not authorized for this city' });
  }

  const row = {};
  for (const field of ALLOWED_FIELDS) {
    if (field in venue) row[field] = venue[field];
  }
  row.source = row.source || 'manual';
  row.is_hidden = false;
  row.is_claimed = false;

  const query = row.google_place_id
    ? supabaseAdmin.from('venues').upsert(row, { onConflict: 'google_place_id' })
    : supabaseAdmin.from('venues').insert(row);

  const { data, error } = await query.select('id').single();
  if (error) return res.status(500).json({ error: 'Add failed', detail: error.message });

  return res.status(200).json({ success: true, id: data.id });
}
