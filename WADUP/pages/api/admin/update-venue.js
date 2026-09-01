import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity } from '../../../lib/admin';

// Never let the client set arbitrary columns (e.g. average_rating,
// google_place_id, owner_id) through this route — only what the Edit modal
// actually exposes.
const EDITABLE_FIELDS = [
  'name', 'custom_emoji', 'categories', 'category', 'subcategory', 'custom_subcategories',
  'is_private', 'is_hidden', 'is_verified', 'hide_new_badge',
  'description', 'cover_photo_url', 'custom_cover_photo',
  'address', 'lat', 'lng', 'phone', 'website',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });

  const { venueId, updates } = req.body || {};
  if (!venueId || !updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Missing venueId or updates' });
  }

  const { data: venue, error: fetchError } = await supabaseAdmin
    .from('venues').select('city').eq('id', venueId).single();
  if (fetchError || !venue) return res.status(404).json({ error: 'Venue not found' });
  if (!canAccessCity(auth.adminRole, venue.city)) {
    return res.status(403).json({ error: 'Not authorized for this city' });
  }

  const safeUpdates = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in updates) safeUpdates[field] = updates[field];
  }
  if (!Object.keys(safeUpdates).length) {
    return res.status(400).json({ error: 'No editable fields in updates' });
  }

  // venues.category (singular) is kept as a fallback for any page not yet
  // updated to read the categories array — sync it to the array's first
  // entry ("primary" category) whenever categories changes, rather than
  // letting it silently go stale the moment a venue is edited.
  if (Array.isArray(safeUpdates.categories)) {
    safeUpdates.category = safeUpdates.categories[0] || null;
  }

  const { error } = await supabaseAdmin.from('venues').update(safeUpdates).eq('id', venueId);
  if (error) return res.status(500).json({ error: 'Update failed', detail: error.message });

  return res.status(200).json({ success: true });
}
