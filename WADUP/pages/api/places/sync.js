// pages/api/places/sync.js — pulls real Chattanooga venues from Google
// Places API (New). NEVER writes a new venue straight to the live `venues`
// table (except the nightlife rebuild path below): a place Google returns
// that isn't already an approved venue lands in `venues_pending` for an
// admin to approve/reject (see pages/admin/venues.js's Pending Approval tab,
// and approve-venue.js/reject-venue.js). Already-approved venues just get
// their Google-sourced fields refreshed. Keyed on google_place_id
// throughout, so re-running this never creates duplicates in either table.
//
// Search/filter/mapping logic (SEARCH_GROUPS, chain + primaryType
// blocklists, mapPlaceToRow, Place Details enrichment) lives in
// lib/placesSync.js, shared with sync-preview.js/sync-save.js (the admin
// Sync Manager's preview-before-save flow) so "what counts as a match"
// can't drift between the two.
import { supabaseAdmin } from '../supabase-admin';
import {
  SEARCH_GROUPS, runSearch, enrichWithPlaceDetails,
} from '../../../lib/placesSync';

// 280 Google API calls (even bounded to 8-at-a-time) can run well past
// Vercel's default Serverless Function timeout — this raises the ceiling as
// far as it goes without a paid-plan-specific override. On a Hobby plan
// this is effectively a no-op (60s is already that plan's hard cap); on Pro
// it actually unlocks the extra time.
export const config = {
  maxDuration: 60,
};

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
  if (!process.env.GOOGLE_PLACES_KEY) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_KEY is not configured on the server' });
  }

  // ?category=<wadupCat> scopes the sync to just that category's SEARCH_GROUPS
  // (e.g. ?category=nightlife runs only the bar/pub/brewery/etc. searches).
  // For 'nightlife' specifically this also switches the write path below to a
  // full delete-and-rebuild instead of the normal pending-queue flow — see
  // isNightlifeRebuild.
  const categoryFilter = req.query.category || null;
  const activeGroups = categoryFilter
    ? SEARCH_GROUPS.filter(g => g.wadupCat === categoryFilter)
    : SEARCH_GROUPS;
  if (categoryFilter && !activeGroups.length) {
    return res.status(400).json({ error: `Unknown category "${categoryFilter}"` });
  }
  const isNightlifeRebuild = categoryFilter === 'nightlife';

  const { rows: allRows, byCategory, errors, skippedChains, skippedNonBar, skippedBlockedType } = await runSearch(activeGroups);

  if (!allRows.length) {
    return res.status(200).json({ success: true, added_to_queue: 0, already_live: 0, skipped: 0, totalFetched: 0, byCategory, skippedChains, skippedNonBar, skippedBlockedType, errors });
  }

  // Nightlife rebuild: wipe every existing google_places-sourced nightlife
  // venue before re-inserting the freshly-filtered set below, rather than
  // going through the usual incremental refresh/pending-queue flow. Manually
  // added venues (source != 'google_places') are untouched.
  //
  // Deleted one row at a time (not a single bulk DELETE) because a venue
  // with real dependent rows — a checkin, review, save, etc. — hits an
  // ON DELETE RESTRICT/NO ACTION foreign key and would abort the whole
  // batch. Any row that fails to delete this way is simply left alone
  // rather than losing that real user data; it falls through to the normal
  // liveByPlaceId match below and gets its Google-sourced fields refreshed
  // in place (same as a regular incremental sync) instead of being replaced.
  let rebuildDeleteFailures = 0;
  if (isNightlifeRebuild) {
    const { data: existingNightlifeRows, error: existingError } = await supabaseAdmin
      .from('venues')
      .select('id')
      .eq('category', 'nightlife')
      .eq('source', 'google_places');
    if (existingError) {
      return res.status(500).json({ error: 'Failed to read existing nightlife venues', detail: existingError.message });
    }
    for (const row of existingNightlifeRows || []) {
      const { error: rowDeleteError } = await supabaseAdmin.from('venues').delete().eq('id', row.id);
      if (rowDeleteError) rebuildDeleteFailures++;
    }
  }

  // Three exclusion lists, checked before anything touches `venues` or
  // `venues_pending`:
  //   - deleted_venues: an admin permanently deleted this place (delete-venue.js)
  //   - venues (already exists): already approved and live — never re-queued,
  //     only refreshed
  //   - venues_pending with status 'rejected': an admin already reviewed and
  //     rejected it, so it must not silently reappear in the queue
  const placeIds = allRows.map(r => r.google_place_id);
  const [
    { data: deletedRows, error: deletedError },
    { data: liveRowsRaw, error: liveError },
    { data: pendingRowsRaw, error: pendingError },
  ] = await Promise.all([
    supabaseAdmin.from('deleted_venues').select('google_place_id').in('google_place_id', placeIds),
    supabaseAdmin.from('venues').select('google_place_id, custom_cover_photo, name, google_reviews, google_photo_refs').in('google_place_id', placeIds),
    supabaseAdmin.from('venues_pending').select('google_place_id, status').in('google_place_id', placeIds),
  ]);
  if (deletedError) return res.status(500).json({ error: 'Failed to read deleted_venues blocklist', detail: deletedError.message });
  if (liveError) return res.status(500).json({ error: 'Failed to read existing venues', detail: liveError.message });
  if (pendingError) return res.status(500).json({ error: 'Failed to read venues_pending', detail: pendingError.message });

  const deletedIds = new Set((deletedRows || []).map(r => r.google_place_id));
  const liveByPlaceId = new Map((liveRowsRaw || []).map(r => [r.google_place_id, r]));
  const rejectedIds = new Set((pendingRowsRaw || []).filter(r => r.status === 'rejected').map(r => r.google_place_id));
  const alreadyPendingIds = new Set((pendingRowsRaw || []).filter(r => r.status !== 'rejected').map(r => r.google_place_id));

  let skipped = 0;
  const liveUpdateCandidates = [];
  const pendingCandidates = [];
  for (const row of allRows) {
    const id = row.google_place_id;
    if (deletedIds.has(id) || rejectedIds.has(id)) { skipped++; continue; }
    if (liveByPlaceId.has(id)) { liveUpdateCandidates.push(row); continue; }
    pendingCandidates.push(row);
  }

  const nowIso = new Date().toISOString();

  // Already-live venues: sync NEVER adds a venue straight to the map — this
  // is purely a refresh of Google-sourced fields (rating, review count,
  // hours, and — unless the admin uploaded their own — the cover photo).
  // Every admin-curated field (name, custom_emoji, categories/category,
  // is_hidden, is_private, is_verified, hide_new_badge, description,
  // subcategory, custom_subcategories, weighted_rating) is left completely
  // untouched: it's simply never included in the update payload below.
  // Split by custom_cover_photo so each upsert batch has a consistent set of
  // columns — PostgREST fills any column omitted from a row (but present on
  // a sibling row in the same batch) with NULL, so mixing the two shapes in
  // one call would blank out cover_photo_url on the venues we mean to protect.
  // `name` is NOT NULL with no default, so PostgREST's upsert would fail the
  // NOT NULL check on its implicit insert branch if it were left out — even
  // though these rows always hit the ON CONFLICT DO UPDATE path. Echoing back
  // each venue's own current name satisfies the constraint as a harmless
  // `name = name` no-op without ever applying Google's name to an existing venue.
  const refreshPhotoRows = liveUpdateCandidates
    .filter(r => !liveByPlaceId.get(r.google_place_id).custom_cover_photo)
    .map(r => ({
      google_place_id: r.google_place_id,
      name: liveByPlaceId.get(r.google_place_id).name,
      google_rating: r.google_rating,
      google_review_count: r.google_review_count,
      hours: r.hours,
      cover_photo_url: r.cover_photo_url,
      last_google_sync: nowIso,
    }));
  const keepPhotoRows = liveUpdateCandidates
    .filter(r => liveByPlaceId.get(r.google_place_id).custom_cover_photo)
    .map(r => ({
      google_place_id: r.google_place_id,
      name: liveByPlaceId.get(r.google_place_id).name,
      google_rating: r.google_rating,
      google_review_count: r.google_review_count,
      hours: r.hours,
      last_google_sync: nowIso,
    }));

  if (refreshPhotoRows.length) {
    const { error } = await supabaseAdmin.from('venues').upsert(refreshPhotoRows, { onConflict: 'google_place_id' });
    if (error) return res.status(500).json({ error: 'Update failed', detail: error.message });
  }
  if (keepPhotoRows.length) {
    const { error } = await supabaseAdmin.from('venues').upsert(keepPhotoRows, { onConflict: 'google_place_id' });
    if (error) return res.status(500).json({ error: 'Update failed', detail: error.message });
  }

  // Nightlife rebuild: every candidate here just had its old row deleted
  // above, so this is a straight re-insert into the live `venues` table —
  // not the pending queue. mapPlaceToRow's output already matches venues'
  // columns exactly (unlike venues_pending, which lacks is_claimed/
  // custom_cover_photo), so no field-stripping is needed.
  if (isNightlifeRebuild) {
    if (pendingCandidates.length) {
      const { error } = await supabaseAdmin.from('venues').insert(pendingCandidates);
      if (error) return res.status(500).json({ error: 'Nightlife rebuild insert failed', detail: error.message });
    }

    // One Place Details call per bar — reviews/photos, which searchNearby
    // can never provide (see lib/placesSync.js's FIELD_MASK comment). Every
    // freshly-inserted bar needs it, but an already-live one only does if
    // it's never been enriched before — re-spending a Details call on a bar
    // that already has reviews/photos stored would be pure waste.
    const needsEnrichment = liveUpdateCandidates.filter(r => {
      const existing = liveByPlaceId.get(r.google_place_id);
      return !(existing?.google_reviews?.length) && !(existing?.google_photo_refs?.length);
    });
    console.log(`[sync] nightlife rebuild: ${pendingCandidates.length} new bars + ${needsEnrichment.length}/${liveUpdateCandidates.length} already-live bars need Place Details (rest already have reviews/photos).`);
    const enrichmentErrors = await enrichWithPlaceDetails([...pendingCandidates, ...needsEnrichment], supabaseAdmin);

    return res.status(200).json({
      success: true,
      rebuilt: true,
      inserted: pendingCandidates.length,
      refreshed: liveUpdateCandidates.length,
      keptDueToRealData: rebuildDeleteFailures,
      enriched: pendingCandidates.length + needsEnrichment.length - enrichmentErrors.length,
      enrichmentErrors,
      skipped,
      totalFetched: allRows.length,
      byCategory,
      skippedChains,
      skippedNonBar,
      skippedBlockedType,
      errors,
    });
  }

  // Everything else — a place never seen before, or one still sitting in the
  // pending queue from an earlier sync — is (re-)upserted into
  // venues_pending for an admin to review via the Pending Approval tab. This
  // is the ONLY path that can introduce a new venue from Google; sync never
  // writes a brand-new row directly into the live `venues` table anymore.
  // `is_claimed`/`custom_cover_photo` aren't columns on venues_pending at
  // all, so they're stripped before the upsert.
  const pendingRowsToUpsert = pendingCandidates.map(({ is_claimed, custom_cover_photo, ...pendingFields }) => ({
    ...pendingFields,
    status: 'pending',
  }));
  const addedToQueue = pendingCandidates.filter(r => !alreadyPendingIds.has(r.google_place_id)).length;

  if (pendingRowsToUpsert.length) {
    const { error } = await supabaseAdmin.from('venues_pending').upsert(pendingRowsToUpsert, { onConflict: 'google_place_id' });
    if (error) return res.status(500).json({ error: 'Pending queue upsert failed', detail: error.message });
  }

  return res.status(200).json({
    success: true,
    added_to_queue: addedToQueue,
    already_live: liveUpdateCandidates.length,
    skipped,
    totalFetched: allRows.length,
    byCategory,
    skippedChains,
    skippedNonBar,
    skippedBlockedType,
    errors,
  });
}
