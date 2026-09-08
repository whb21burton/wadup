// pages/api/places/sync-preview.js — runs the same Google Places search as
// sync.js. IMPORTANT COST NOTE: Google's Nearby Search is billed per SEARCH
// CALL (SEARCH_GROUPS × SEARCH_CENTERS), not per place returned — there is
// no way to ask Google to skip places we already have, so this still makes
// the full set of search calls every time. What this DOES avoid: showing an
// admin the same already-known venues over and over, writing them back into
// `venues` unnecessarily, and (in sync.js) re-spending a Place Details call
// on a venue that already has reviews/photos. A place already in `venues`
// gets a lightweight rating/hours refresh right here and is left out of the
// preview entirely; a place in `deleted_venues` (permanently rejected by an
// admin) is dropped outright — never shown, never touched. Only genuinely
// new places are returned for review — see pages/admin/sync.js and
// sync-save.js, which writes what gets approved.
import { requireAdmin } from '../admin/_authAdmin';
import { supabaseAdmin } from '../supabase-admin';
import { SEARCH_GROUPS, runSearchForPreview } from '../../../lib/placesSync';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });
  if (!process.env.GOOGLE_PLACES_KEY) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_KEY is not configured on the server' });
  }

  const category = req.query.category || null;
  const activeGroups = category
    ? SEARCH_GROUPS.filter(g => g.wadupCat === category)
    : SEARCH_GROUPS;
  if (category && !activeGroups.length) {
    return res.status(400).json({ error: `Unknown category "${category}"` });
  }

  const { rows, errors } = await runSearchForPreview(activeGroups);
  console.log(`[sync-preview] Google search returned ${rows.length} distinct places for category=${category || 'all'}.`);

  if (!rows.length) {
    return res.status(200).json({ success: true, venues: [], totalFound: 0, alreadyKnown: 0, refreshed: 0, errors });
  }

  const placeIds = rows.map(r => r.google_place_id);
  const [{ data: liveRows }, { data: deletedRows }] = await Promise.all([
    supabaseAdmin.from('venues').select('google_place_id').in('google_place_id', placeIds),
    supabaseAdmin.from('deleted_venues').select('google_place_id').in('google_place_id', placeIds),
  ]);
  const liveIds = new Set((liveRows || []).map(r => r.google_place_id));
  const deletedIds = new Set((deletedRows || []).map(r => r.google_place_id));

  const newPlaces = [];
  const alreadyLive = [];
  let skippedDeleted = 0;
  for (const row of rows) {
    if (deletedIds.has(row.google_place_id)) { skippedDeleted++; continue; } // permanently rejected — never touched
    if (liveIds.has(row.google_place_id)) { alreadyLive.push(row); continue; }
    newPlaces.push(row);
  }

  // Already-live venues never appear in the preview for approve/reject —
  // just a minimal rating/hours refresh, no new API cost (this data came
  // from the search call above, not an extra fetch), and every
  // admin-curated field (name, description, categories, custom_emoji,
  // is_hidden/is_private/is_verified, etc.) is left completely untouched.
  const nowIso = new Date().toISOString();
  let refreshed = 0;
  for (const row of alreadyLive) {
    const { error } = await supabaseAdmin
      .from('venues')
      .update({
        google_rating: row.google_rating,
        google_review_count: row.google_review_count,
        hours: row.hours,
        last_google_sync: nowIso,
      })
      .eq('google_place_id', row.google_place_id);
    if (!error) refreshed++;
  }

  console.log(`[sync-preview] ${newPlaces.length} new, ${refreshed} already-live venues refreshed (rating/hours only), ${skippedDeleted} permanently-deleted places skipped.`);

  return res.status(200).json({
    success: true,
    venues: newPlaces,
    totalFound: rows.length,
    alreadyKnown: alreadyLive.length,
    refreshed,
    skippedDeleted,
    errors,
  });
}
