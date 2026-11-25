// Conservative, resumable Chattanooga-outward venue discovery.
// One Google Nearby Search (Pro field mask) per run; eight runs/day = <=248/month.
// Bounded by local daily/monthly request counters; Google may bill these calls.
import { loadCronDatabase } from '../../../lib/cron-auth';
import { searchNearby, isChain, isBlockedPrimaryType } from '../../../lib/placesSync';

export const config = { maxDuration: 60 };
const CENTER = { lat: 35.0456, lng: -85.3096 };
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
  if (process.env.GOOGLE_PLACES_FREE_BUDGET_VERIFIED !== 'true')
    return res.json({ status: 'google_budget_not_verified' });
  const key = process.env.GOOGLE_DISCOVERY_KEY;
  const region = process.env.GOOGLE_DISCOVERY_REGION;
  if (!key || !region) return res.status(503).json({ status: 'discovery_scope_unconfigured' });
  const supabaseAdmin = await loadCronDatabase();
  if (!supabaseAdmin) return res.status(503).json({ status: 'cron_database_unavailable' });

  const now = Date.now();
  // A lost worker keeps its budget reservation. Recover its tile with a
  // cooldown rather than repeating the same search immediately.
  const { error: recoveryError } = await supabaseAdmin.from('restaurant_coverage_tiles')
    .update({ status: 'queued', last_error: 'Interrupted worker' })
    .eq('region', region).eq('status', 'running').lt('started_at', new Date(now - 15 * 60000).toISOString());
  if (recoveryError) return res.status(503).json({ status: 'tile_recovery_failed' });

  const candidates = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from('restaurant_coverage_tiles')
      .select('id,lat,lng,radius_m,attempts').eq('region', region).eq('status', 'queued')
      .or(`last_error.is.null,started_at.lte.${new Date(now - 6 * 3600000).toISOString()}`)
      .order('id').range(from, from + 499);
    if (error) return res.status(503).json({ status: 'tile_query_failed' });
    candidates.push(...data);
    if (data.length < 500) break;
  }
  const tile = candidates.sort((a,b) => distance(a) - distance(b) || a.id - b.id)[0];
  if (!tile) return res.json({ status: 'no_ready_tiles', region });
  const task = TYPES[tile.attempts];
  if (!task) return res.status(503).json({ status: 'invalid_category_cursor' });

  const { data: job, error: reserveError } = await supabaseAdmin.rpc('reserve_places_discovery', { p_tile_id: tile.id });
  if (reserveError || !job) return res.status(503).json({ status: 'usage_reservation_failed' });
  if (job.status !== 'reserved') return res.json({ status: job.status });

  let ids = [];
  let failure = null;
  try {
    const places = await searchNearby([task.type], { lat:tile.lat, lng:tile.lng, radius:tile.radius_m },
      { discoveryOnly:true, apiKey:key, signal:AbortSignal.timeout(15000) });
    ids = [...new Set(places.filter(place => place.id && !isChain(place.displayName?.text) && categoryFor(place, task.category)).map(place => place.id))];
  } catch {
    failure = 'Nearby Search did not complete';
  }
  const { data: result, error } = await supabaseAdmin.rpc('finish_places_discovery', {
    p_run_id:job.id, p_place_ids:ids, p_error:failure,
  });
  if (error || !result) return res.status(503).json({ status: 'tile_completion_failed' });
  return res.status(failure ? 502 : 200).json({ ...result, region, tile:tile.id, category:task.category });
}