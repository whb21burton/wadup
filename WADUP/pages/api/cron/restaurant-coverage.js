// Work outward within each configured city, reserving each search before sending it.
import { loadCronDatabase } from '../../../lib/cron-auth';
import { searchNearby, isChain, isBlockedPrimaryType } from '../../../lib/placesSync';
import { DISCOVERY_SEARCHES_PER_SLOT, DISCOVERY_SLOT_MINUTES, discoveryRegions, tileDistance } from '../../../lib/google-discovery-plan';

export const config = { maxDuration: 60 };
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
async function readRegionQueue(supabaseAdmin, center, now) {
  const region = center.name;
  // A lost worker keeps its budget reservation. Recover its tile with a
  // cooldown rather than repeating the same search immediately.
  const { error: recoveryError } = await supabaseAdmin.from('restaurant_coverage_tiles')
    .update({ status: 'queued', last_error: 'Interrupted worker' })
    .eq('region', region).eq('status', 'running').lt('started_at', new Date(now - 15 * 60000).toISOString());
  if (recoveryError) return { error: 'tile_recovery_failed' };

  const candidates = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from('restaurant_coverage_tiles')
      .select('id,lat,lng,radius_m,attempts').eq('region', region).eq('status', 'queued')
      .or(`last_error.is.null,started_at.lte.${new Date(now - 6 * 3600000).toISOString()}`)
      .order('id').range(from, from + 499);
    if (error) return { error: 'tile_query_failed' };
    candidates.push(...data);
    if (data.length < 500) break;
  }
  if (candidates.length) return { candidates: candidates.sort((a, b) =>
    tileDistance(a, center) - tileDistance(b, center) || a.id - b.id) };
  const { count, error } = await supabaseAdmin.from('restaurant_coverage_tiles')
    .select('id', { count: 'exact', head: true }).eq('region', region).neq('status', 'done');
  if (error || count == null) return { error: 'tile_query_failed' };
  return { waiting: count > 0 };
}

async function runCategory(supabaseAdmin, tile, key) {
  const { data: job, error: reserveError } = await supabaseAdmin.rpc('reserve_places_discovery', { p_tile_id: tile.id });
  if (reserveError || !job) return { status: 'usage_reservation_failed', code: 503 };
  if (job.status !== 'reserved') return { status: job.status };
  const task = TYPES[job.category_cursor];
  if (!task) return { status: 'invalid_category_cursor', code: 503 };

  let ids = [];
  let failure = null;
  try {
    const places = await searchNearby([task.type], { lat:tile.lat, lng:tile.lng, radius:tile.radius_m },
      { discoveryOnly:true, apiKey:key, signal:AbortSignal.timeout(15000) });
    ids = [...new Set(places.filter(place => place.id && !isChain(place.displayName?.text) && categoryFor(place, task.category)).map(place => place.id))];
  } catch (error) {
    failure = [401, 403, 429].includes(error?.status)
      ? 'Nearby Search access or quota rejected'
      : 'Nearby Search did not complete';
  }
  const { data: result, error } = await supabaseAdmin.rpc('finish_places_discovery', {
    p_run_id:job.id, p_place_ids:ids, p_error:failure,
  });
  if (error || !result) return { status: 'tile_completion_failed', code: 503 };
  return { ...result, code: failure ? 502 : 200, tile: tile.id, category: task.category };
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV === 'preview') return res.status(200).json({ enabled: false });
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' });
  if (process.env.GOOGLE_PLACES_FREE_BUDGET_VERIFIED !== 'true')
    return res.json({ status: 'google_budget_not_verified' });
  const key = process.env.GOOGLE_DISCOVERY_KEY;
  const regions = discoveryRegions(process.env.GOOGLE_DISCOVERY_REGIONS, process.env.GOOGLE_DISCOVERY_REGION);
  if (!key || !regions.length) return res.status(503).json({ status: 'discovery_scope_unconfigured' });
  const supabaseAdmin = await loadCronDatabase();
  if (!supabaseAdmin) return res.status(503).json({ status: 'cron_database_unavailable' });

  const now = Date.now();
  const slotDuration = DISCOVERY_SLOT_MINUTES * 60000;
  const slotEnd = (Math.floor(now / slotDuration) + 1) * slotDuration;
  for (const region of regions) {
    const queue = await readRegionQueue(supabaseAdmin, region, now);
    if (queue.error) return res.status(503).json({ status: queue.error });
    if (queue.waiting) return res.json({ status: 'region_waiting_for_retry', region: region.name });
    if (!queue.candidates) continue;

    const results = [];
    let status = 'done';
    let code = 200;
    for (let slot = 0; slot < DISCOVERY_SEARCHES_PER_SLOT && queue.candidates.length; slot++) {
      if (Date.now() >= slotEnd) break;
      const { code: attemptCode, ...result } = await runCategory(supabaseAdmin, queue.candidates[0], key);
      status = result.status;
      code = attemptCode || 200;
      if (result.tile != null) results.push(result);
      if (status === 'tile_already_claimed' || result.category_progress === TYPES.length) queue.candidates.shift();
      if (status !== 'done' && status !== 'tile_already_claimed') break;
    }
    return res.status(code).json({ status, region: region.name, results });
  }
  return res.json({ status: 'no_ready_tiles' });
}
