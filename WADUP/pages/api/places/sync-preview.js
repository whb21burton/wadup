// pages/api/places/sync-preview.js — runs the same Google Places search as
// sync.js but NEVER writes anything. Returns every raw result (chains and
// blocked-primaryType places included, each flagged) so an admin can review
// and override before anything is saved — see pages/admin/sync.js and
// sync-save.js, which actually writes what gets approved here.
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

  // A place an admin already permanently deleted should never resurface in
  // a preview to be re-approved by mistake.
  const placeIds = rows.map(r => r.google_place_id);
  const { data: deletedRows } = await supabaseAdmin
    .from('deleted_venues')
    .select('google_place_id')
    .in('google_place_id', placeIds.length ? placeIds : ['']);
  const deletedIds = new Set((deletedRows || []).map(r => r.google_place_id));
  const venues = rows.filter(r => !deletedIds.has(r.google_place_id));

  return res.status(200).json({ success: true, venues, errors });
}
