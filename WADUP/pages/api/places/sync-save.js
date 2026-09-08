// pages/api/places/sync-save.js — writes what an admin approved/rejected in
// the Sync Manager preview (pages/admin/sync.js + sync-preview.js). Unlike
// the normal incremental sync.js, approved venues go straight into the live
// `venues` table: the admin already reviewed each one in the preview UI, so
// there's no need for a second venues_pending review pass on top of that.
import { requireAdmin } from '../admin/_authAdmin';
import { supabaseAdmin } from '../supabase-admin';

// Preview-only annotation fields — venues has no columns for these, so they
// must be stripped before writing.
function stripPreviewFields({ primaryType, isChain, isBlockedType, isPreviouslyDeleted, ...row }) {
  return row;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });

  const { venues, rejected } = req.body || {};
  if (!Array.isArray(venues)) {
    return res.status(400).json({ error: 'venues must be an array' });
  }

  const rows = venues.filter(v => v?.google_place_id).map(stripPreviewFields);
  let saved = 0;
  if (rows.length) {
    const { error } = await supabaseAdmin.from('venues').upsert(rows, { onConflict: 'google_place_id' });
    if (error) return res.status(500).json({ error: 'Save failed', detail: error.message });
    saved = rows.length;
    // These are now live — an identical row left over in the pending queue
    // from an earlier incremental sync would just be a confusing duplicate.
    await supabaseAdmin.from('venues_pending').delete().in('google_place_id', rows.map(r => r.google_place_id));
  }

  let rejectedCount = 0;
  if (Array.isArray(rejected) && rejected.length) {
    const rejectRows = rejected
      .filter(v => v?.google_place_id)
      .map(v => ({ name: v.name, google_place_id: v.google_place_id, reason: 'admin rejected in sync preview' }));
    if (rejectRows.length) {
      const { error } = await supabaseAdmin.from('deleted_venues').upsert(rejectRows, { onConflict: 'google_place_id' });
      if (error) return res.status(500).json({ error: 'Failed to record rejections', detail: error.message });
      rejectedCount = rejectRows.length;
      await supabaseAdmin.from('venues_pending').delete().in('google_place_id', rejectRows.map(r => r.google_place_id));
    }
  }

  return res.status(200).json({ success: true, saved, rejected: rejectedCount });
}
