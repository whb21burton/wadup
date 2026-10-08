import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity } from '../../../lib/admin';

// Never let the client set arbitrary columns (e.g. average_rating,
// google_place_id, owner_id) through this route — only what the Edit modal
// actually exposes.
const EDITABLE_FIELDS = [
  'name', 'custom_emoji', 'categories', 'category', 'subcategory', 'subcategories', 'custom_subcategories',
  'is_private', 'is_hidden', 'is_verified', 'hide_new_badge',
  'description', 'cover_photo_url', 'custom_cover_photo',
  'address', 'lat', 'lng', 'phone', 'website', 'admin_rank_number', 'admin_rating',
  // event_rank was missing here since the Event Rankings drag-and-drop tab
  // (pages/admin/venues.js) was added — every save through this endpoint
  // was silently dropped (falls through to "No editable fields in updates"
  // when it's the only field sent), so no reorder has actually persisted.
  'event_rank',
  'scraping_enabled', 'scraping_url',
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

  // Same deal for venues.subcategory (singular): it's the "primary"
  // subcategory every single-value reader still uses (map pins, discover and
  // browse cards, search, lib/rankings' VENUE_CARD_FIELDS), so keep it
  // pinned to the array's first entry rather than letting the two disagree.
  if (Array.isArray(safeUpdates.subcategories)) {
    safeUpdates.subcategories = safeUpdates.subcategories
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);
    safeUpdates.subcategory = safeUpdates.subcategories[0] || null;
  } else if ('subcategory' in safeUpdates) {
    // ...and mirror the other direction too. pages/admin/venues.js's
    // EditVenueModal still sends only the scalar, and the map's subcategory
    // filter reads the ARRAY first (venueSubcategories), so without this a
    // scalar-only edit would leave the old array in place and appear to do
    // nothing on the map.
    const scalar = typeof safeUpdates.subcategory === 'string' ? safeUpdates.subcategory.trim() : '';
    safeUpdates.subcategory = scalar || null;
    safeUpdates.subcategories = scalar ? [scalar] : [];
  }

  const { error } = await supabaseAdmin.from('venues').update(safeUpdates).eq('id', venueId);
  if (error) return res.status(500).json({ error: 'Update failed', detail: error.message });

  return res.status(200).json({ success: true });
}
