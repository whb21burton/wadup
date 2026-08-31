// pages/api/admin/approve-venue.js — moves a venues_pending row onto the
// live map. `overrides` lets the admin's "Edit & Approve" flow (see the
// Pending Approval tab in pages/admin/venues.js) change the same fields the
// regular Edit modal exposes before the venue goes live; a plain "Approve"
// just sends no overrides and takes the pending row's Google-sourced data as-is.
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

  const { pendingId, overrides } = req.body || {};
  if (!pendingId) return res.status(400).json({ error: 'Missing pendingId' });

  const { data: pending, error: fetchError } = await supabaseAdmin
    .from('venues_pending').select('*').eq('id', pendingId).single();
  if (fetchError || !pending) return res.status(404).json({ error: 'Pending venue not found' });
  if (!canAccessCity(auth.adminRole, pending.city)) {
    return res.status(403).json({ error: 'Not authorized for this city' });
  }

  const o = overrides || {};
  const categories = Array.isArray(o.categories) && o.categories.length
    ? o.categories
    : (pending.categories?.length ? pending.categories : (pending.category ? [pending.category] : []));

  const venueRow = {
    google_place_id: pending.google_place_id,
    name: o.name || pending.name,
    categories,
    category: categories[0] || null,
    subcategory: o.subcategory !== undefined ? o.subcategory : pending.subcategory,
    custom_emoji: o.custom_emoji || null,
    address: pending.address,
    city: pending.city,
    state: pending.state,
    lat: pending.lat,
    lng: pending.lng,
    phone: pending.phone,
    website: pending.website,
    google_rating: pending.google_rating,
    google_review_count: pending.google_review_count,
    cover_photo_url: pending.cover_photo_url,
    hours: pending.hours,
    is_claimed: false,
    is_hidden: !!o.is_hidden,
    is_verified: !!o.is_verified,
    is_private: !!o.is_private,
    hide_new_badge: !!o.hide_new_badge,
    custom_cover_photo: false,
    source: pending.source || 'google_places',
    last_google_sync: new Date().toISOString(),
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('venues').insert(venueRow).select('id').single();
  if (insertError) return res.status(500).json({ error: 'Approve failed', detail: insertError.message });

  const { error: deleteError } = await supabaseAdmin.from('venues_pending').delete().eq('id', pendingId);
  if (deleteError) return res.status(500).json({ error: 'Approved, but failed to clear pending queue row', detail: deleteError.message });

  return res.status(200).json({ success: true, venueId: inserted.id });
}
