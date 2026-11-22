// Conservative, resumable Chattanooga-outward venue discovery.
// One Google Nearby Search (Pro field mask) per run; eight runs/day = <=248/month.
// An external, verified Google Cloud billing guard is still required before spending.
import { supabaseAdmin } from '../supabase-admin';
import { searchNearby, mapPlaceToRow, isChain, isBlockedPrimaryType } from '../../../lib/placesSync';

export const config = { maxDuration: 60 };
const CENTER = { lat: 35.0456, lng: -85.3096 };
const MONTHLY_LIMIT = 250;
const DAILY_LIMIT = 8;
const TYPES = [
  { type: 'restaurant', category: 'restaurant' },
  { type: 'bar', category: 'nightlife' },
  { type: 'cafe', category: 'coffee' },
  { type: 'park', category: 'outdoors' },
  { type: 'bowling_alley', category: 'activities' },
  { type: 'concert_hall', category: 'events' },
  { type: 'clothing_store', category: 'shopping' },
  { type: 'tourist_attraction', category: 'must-see' },
];
const SHOPPING_TYPES = new Set(['clothing_store','shoe_store','jewelry_store','book_store','gift_shop','shopping_mall','market','store']);
const COFFEE_TYPES = new Set(['cafe','coffee_shop']);
const RESTAURANT_TYPES = new Set(['restaurant','american_restaurant','italian_restaurant','mexican_restaurant','chinese_restaurant','japanese_restaurant','thai_restaurant','pizza_restaurant','sandwich_shop','bakery','steak_house','seafood_restaurant','hamburger_restaurant','barbecue_restaurant']);
const NIGHTLIFE_TYPES = new Set(['bar','pub','night_club','brewery','sports_bar','cocktail_bar','wine_bar','karaoke']);
const OUTDOORS_TYPES = new Set(['park','national_park','hiking_area','campground','dog_park']);
const EVENTS_TYPES = new Set(['concert_hall','performing_arts_theater','comedy_club','event_venue','movie_theater']);
const ACTIVITIES_TYPES = new Set(['bowling_alley','miniature_golf_course','amusement_center','escape_room','golf_course','sports_complex','museum']);
function categoryFor(place, searched) {
  const primary = place.primaryType;
  if (isBlockedPrimaryType(primary) && !(searched === 'shopping' && SHOPPING_TYPES.has(primary))) return null;
  if (primary === 'ice_cream_shop') return null;
  if (COFFEE_TYPES.has(primary)) return 'coffee';
  if (NIGHTLIFE_TYPES.has(primary)) return 'nightlife';
  if (RESTAURANT_TYPES.has(primary)) return 'restaurant';
  if (OUTDOORS_TYPES.has(primary)) return 'outdoors';
  if (EVENTS_TYPES.has(primary)) return 'events';
  if (ACTIVITIES_TYPES.has(primary)) return 'activities';
  if (SHOPPING_TYPES.has(primary)) return 'shopping';
  if (primary === 'tourist_attraction') return 'must-see';
  // Avoid misclassifying a result from a broad Google includedTypes match.
  return primary ? null : searched;
}
const distance = t => {
  const dLat = (Number(t.lat) - CENTER.lat) * 111.2;
  const dLng = (Number(t.lng) - CENTER.lng) * 91.2;
  return dLat * dLat + dLng * dLng;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' });
  // A self-imposed request counter does not guarantee no charges. Do not
  // silently bypass the original externally verified spending protection.
  if (process.env.GOOGLE_PLACES_FREE_BUDGET_VERIFIED !== 'true')
    return res.json({ status: 'paused_unverified_google_billing_guard' });
  if (!process.env.GOOGLE_PLACES_KEY)
    return res.status(503).json({ status: 'missing_google_places_key' });

  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const monthStart = `${month}-01T00:00:00.000Z`;
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const [snapshotsResult, monthResult, dayResult] = await Promise.all([
    supabaseAdmin.from('google_api_budget_snapshots').select('requests,captured_at')
      .eq('month_utc', month).eq('sku', 'nearby_search_pro').eq('source', 'google_cloud')
      .order('captured_at', { ascending: false }).limit(1),
    supabaseAdmin.from('restaurant_coverage_runs').select('api_calls,started_at').gte('started_at', monthStart),
    supabaseAdmin.from('restaurant_coverage_runs').select('api_calls').gte('started_at', dayStart.toISOString()),
  ]);
  if (snapshotsResult.error || monthResult.error || dayResult.error)
    return res.status(503).json({ status: 'budget_check_unavailable' });
  const snapshot = snapshotsResult.data?.[0];
  if (!snapshot || now.getTime() - new Date(snapshot.captured_at).getTime() > 6 * 3600000)
    return res.json({ status: 'paused_missing_fresh_google_sku_snapshot' });
  const afterSnapshot = (monthResult.data || []).filter(r => new Date(r.started_at) > new Date(snapshot.captured_at))
    .reduce((sum, r) => sum + (r.api_calls || 0), 0);
  const monthCalls = (monthResult.data || []).reduce((sum, r) => sum + (r.api_calls || 0), 0);
  const dayCalls = (dayResult.data || []).reduce((sum, r) => sum + (r.api_calls || 0), 0);
  if (snapshot.requests + afterSnapshot >= MONTHLY_LIMIT || monthCalls >= MONTHLY_LIMIT)
    return res.json({ status: 'monthly_limit_reached', monthlyLimit: MONTHLY_LIMIT });
  if (dayCalls >= DAILY_LIMIT)
    return res.json({ status: 'daily_limit_reached', dailyLimit: DAILY_LIMIT });

  // Recover stale interrupted tiles; attempts is the next category cursor (0..7).
  await supabaseAdmin.from('restaurant_coverage_tiles').update({ status: 'queued' })
    .eq('status', 'running').lt('started_at', new Date(now.getTime() - 15 * 60000).toISOString());
  const { data: tiles, error: tileError } = await supabaseAdmin
    .from('restaurant_coverage_tiles').select('id,lat,lng,radius_m,attempts,status')
    .eq('status', 'queued').limit(1000);
  if (tileError) return res.status(503).json({ status: 'tile_query_failed' });
  const tile = (tiles || []).sort((a,b) => distance(a) - distance(b) || a.id - b.id)[0];
  if (!tile) return res.json({ status: 'all_tiles_processed' });
  const cursor = Math.min(Number(tile.attempts || 0), TYPES.length - 1);
  const task = TYPES[cursor];
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('restaurant_coverage_tiles').update({ status: 'running', started_at: now.toISOString() })
    .eq('id', tile.id).eq('status', 'queued').select('id');
  if (claimError || !claimed?.length) return res.status(409).json({ status: 'tile_already_claimed' });
  // Reserve one API call before issuing it, including if Google later errors.
  const { data: run, error: runError } = await supabaseAdmin
    .from('restaurant_coverage_runs').insert({ tile_id: tile.id, api_calls: 1 })
    .select('id').single();
  if (runError) {
    await supabaseAdmin.from('restaurant_coverage_tiles').update({ status: 'queued' }).eq('id', tile.id);
    return res.status(503).json({ status: 'usage_reservation_failed' });
  }
  try {
    const places = await searchNearby([task.type],
      { lat: Number(tile.lat), lng: Number(tile.lng), radius: Number(tile.radius_m) },
      { discoveryOnly: true });
    const byId = new Map();
    for (const place of places) {
      if (!place.id || !place.location || isChain(place.displayName?.text)) continue;
      const cat = categoryFor(place, task.category);
      if (!cat) continue;
      if (!byId.has(place.id)) byId.set(place.id, mapPlaceToRow(place, cat));
    }
    const rows = [...byId.values()];
    let staged = 0;
    if (rows.length) {
      const ids = rows.map(r => r.google_place_id);
      const [live, pending, deleted] = await Promise.all([
        supabaseAdmin.from('venues').select('google_place_id').in('google_place_id', ids),
        supabaseAdmin.from('venues_pending').select('google_place_id').in('google_place_id', ids),
        supabaseAdmin.from('deleted_venues').select('google_place_id').in('google_place_id', ids),
      ]);
      if (live.error || pending.error || deleted.error) throw Error(live.error?.message || pending.error?.message || deleted.error?.message);
      const known = new Set([...(live.data || []), ...(pending.data || []), ...(deleted.data || [])].map(r => r.google_place_id));
      const fresh = rows.filter(r => !known.has(r.google_place_id));
      if (fresh.length) {
        const { error } = await supabaseAdmin.from('venues_pending')
          .upsert(fresh.map(r => ({ ...r, status: 'pending' })), { onConflict: 'google_place_id' });
        if (error) throw error;
        staged = fresh.length;
      }
    }
    const complete = cursor + 1 >= TYPES.length;
    await supabaseAdmin.from('restaurant_coverage_tiles').update({
      status: complete ? 'done' : 'queued', attempts: cursor + 1,
      discovered: (Number(tile.discovered) || 0) + rows.length,
      staged: (Number(tile.staged) || 0) + staged,
      completed_at: complete ? new Date().toISOString() : null,
      last_error: null,
    }).eq('id', tile.id);
    await supabaseAdmin.from('restaurant_coverage_runs').update({
      status: 'done', discovered: rows.length, staged, finished_at: new Date().toISOString(),
    }).eq('id', run.id);
    return res.json({ status: 'done', tile: tile.id, categorySearched: task.category,
      classified: rows.length, staged, categoryProgress: cursor + 1, categoriesPerTile: TYPES.length });
  } catch (e) {
    await supabaseAdmin.from('restaurant_coverage_tiles').update({
      status: 'queued', last_error: String(e.message).slice(0, 500),
    }).eq('id', tile.id);
    await supabaseAdmin.from('restaurant_coverage_runs').update({
      status: 'error', error: String(e.message).slice(0, 500), finished_at: new Date().toISOString(),
    }).eq('id', run.id);
    return res.status(500).json({ status: 'error', category: task.category, error: String(e.message) });
  }
}
