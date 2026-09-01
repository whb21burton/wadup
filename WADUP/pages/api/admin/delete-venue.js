// pages/api/admin/delete-venue.js — permanently removes a venue row.
// Super admin only: an ambassador can hide a bad listing (reversible by a
// super admin later), but a real, irreversible delete is reserved for the
// higher trust tier.
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { isSuperAdmin } from '../../../lib/admin';

// Tables with a plain (NO ACTION, not CASCADE) foreign key to venues.id —
// any real venue with activity against it (a checkin, a review, a saved
// entry, a scheduled event/photo) will make a bare `DELETE FROM venues`
// fail with a foreign-key violation, which is exactly the 500 this file was
// throwing. review_likes/review_reports get an extra pass first since they
// in turn reference reviews.id with their own NO ACTION FK.
const DEPENDENT_TABLES = ['reviews', 'checkins', 'saved_venues', 'venue_events', 'venue_schedule', 'venue_photos'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = await requireAdmin(req);
    if (!auth) return res.status(403).json({ error: 'Not authorized' });
    if (!isSuperAdmin(auth.adminRole)) return res.status(403).json({ error: 'Super admin only' });

    const { venueId } = req.body || {};
    if (!venueId) return res.status(400).json({ error: 'Missing venueId' });

    console.log('[delete-venue] request: venueId =', venueId, 'by user =', auth.user.id);

    const { data: venue, error: fetchError } = await supabaseAdmin
      .from('venues').select('google_place_id, name').eq('id', venueId).single();
    if (fetchError || !venue) {
      console.error('[delete-venue] venue not found:', venueId, fetchError?.message);
      return res.status(404).json({ error: 'Venue not found' });
    }
    console.log('[delete-venue] found venue:', venue.name, 'google_place_id:', venue.google_place_id);

    // Record the delete in the permanent deleted_venues blocklist BEFORE
    // removing the row — /api/places/sync checks this table by google_place_id
    // so a deleted venue never gets silently re-inserted by the next sync.
    if (venue.google_place_id) {
      const { error: blocklistError } = await supabaseAdmin.from('deleted_venues').upsert(
        { google_place_id: venue.google_place_id, name: venue.name, deleted_by: auth.user.id },
        { onConflict: 'google_place_id' }
      );
      if (blocklistError) {
        console.error('[delete-venue] blocklist upsert failed:', blocklistError.message);
        return res.status(500).json({ error: 'Failed to record deletion', detail: blocklistError.message });
      }
      console.log('[delete-venue] recorded in deleted_venues blocklist');
    }

    const { data: venueReviews, error: reviewsLookupError } = await supabaseAdmin
      .from('reviews').select('id').eq('venue_id', venueId);
    if (reviewsLookupError) {
      console.error('[delete-venue] failed looking up reviews:', reviewsLookupError.message);
      return res.status(500).json({ error: 'Delete failed', detail: reviewsLookupError.message });
    }
    const reviewIds = (venueReviews || []).map(r => r.id);
    if (reviewIds.length) {
      console.log('[delete-venue] clearing', reviewIds.length, 'review(s) and their likes/reports');
      const { error: likesError } = await supabaseAdmin.from('review_likes').delete().in('review_id', reviewIds);
      if (likesError) {
        console.error('[delete-venue] failed clearing review_likes:', likesError.message);
        return res.status(500).json({ error: 'Delete failed', detail: likesError.message });
      }
      const { error: reportsError } = await supabaseAdmin.from('review_reports').delete().in('review_id', reviewIds);
      if (reportsError) {
        console.error('[delete-venue] failed clearing review_reports:', reportsError.message);
        return res.status(500).json({ error: 'Delete failed', detail: reportsError.message });
      }
    }

    for (const table of DEPENDENT_TABLES) {
      const { error: cleanupError } = await supabaseAdmin.from(table).delete().eq('venue_id', venueId);
      if (cleanupError) {
        console.error(`[delete-venue] failed clearing ${table}:`, cleanupError.message);
        return res.status(500).json({ error: 'Delete failed', detail: cleanupError.message });
      }
    }
    console.log('[delete-venue] cleared all dependent rows');

    const { error: deleteError } = await supabaseAdmin.from('venues').delete().eq('id', venueId);
    if (deleteError) {
      console.error('[delete-venue] venue delete failed:', deleteError.message);
      return res.status(500).json({ error: 'Delete failed', detail: deleteError.message });
    }

    console.log('[delete-venue] success:', venueId);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[delete-venue] unexpected error:', err.message, err.stack);
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
}
