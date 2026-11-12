// Geographic discovery batch. Call once per grid cell; do not run an
// unbounded national scan from a serverless request.
// Auth: same admin sync password as /api/places/sync.
// POST {lat, lng, radiusMeters: 3000, save: false}
// save=true stages unmatched places in venues_pending for verification.
// Google Places bills search requests; 4 per invocation at most.
import { supabaseAdmin } from '../supabase-admin';
import { searchNearby, mapPlaceToRow, isChain, isBlockedPrimaryType } from '../../../lib/placesSync';

export const config = { maxDuration: 60 };
const TYPES = ['restaurant', 'cafe', 'bakery'];
const valid = (x, min, max) => Number.isFinite(x) && x >= min && x <= max;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  if (!process.env.ADMIN_SYNC_PASSWORD || req.headers['x-admin-password'] !== process.env.ADMIN_SYNC_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.GOOGLE_PLACES_KEY) return res.status(500).json({ error: 'Google Places key missing' });
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  const radius = Number(req.body?.radiusMeters ?? 3000);
  if (!valid(lat, -90, 90) || !valid(lng, -180, 180) || !valid(radius, 500, 10000))
    return res.status(400).json({ error: 'Invalid center or radius' });

  const byId = new Map(), errors = [];
  for (const type of TYPES) {
    try {
      const places = await searchNearby([type], { lat, lng, radius });
      for (const place of places) {
        if (!place.id || !place.location || isChain(place.displayName?.text) ||
            isBlockedPrimaryType(place.primaryType)) continue;
        // A cafe or bakery is included only if it serves prepared food/drinks.
        if (!byId.has(place.id)) byId.set(place.id, mapPlaceToRow(place, 'restaurant'));
      }
    } catch (e) { errors.push({ type, message: e.message }); }
  }
  const discovered = [...byId.values()];
  const ids = discovered.map(v => v.google_place_id);
  if (!ids.length) return res.json({ discovered: 0, staged: 0, errors });
  const [{ data: live, error: liveErr }, { data: pending, error: pendingErr }] = await Promise.all([
    supabaseAdmin.from('venues').select('google_place_id').in('google_place_id', ids),
    supabaseAdmin.from('venues_pending').select('google_place_id').in('google_place_id', ids),
  ]);
  if (liveErr || pendingErr) return res.status(500).json({ error: 'Failed to check duplicates' });
  const known = new Set([...(live || []), ...(pending || [])].map(v => v.google_place_id));
  const candidates = discovered.filter(v => !known.has(v.google_place_id));
  if (req.body?.save === true && candidates.length) {
    const { error } = await supabaseAdmin.from('venues_pending').upsert(
      candidates.map(v => ({ ...v, status: 'pending' })), { onConflict: 'google_place_id' }
    );
    if (error) return res.status(500).json({ error: 'Staging failed', detail: error.message });
  }
  return res.json({
    center: { lat, lng, radiusMeters: radius },
    searchCalls: TYPES.length, discovered: discovered.length,
    alreadyKnown: discovered.length - candidates.length,
    candidates: candidates.length, staged: req.body?.save === true ? candidates.length : 0,
    sample: candidates.slice(0, 20).map(v => ({ name: v.name, city: v.city, address: v.address })),
    errors,
  });
}
