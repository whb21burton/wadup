// Conservative, resumable Chattanooga-outward venue discovery.
// One Google Nearby Search (Pro field mask) per run; eight runs/day = <=248/month.
// Bounded by local daily/monthly request counters; Google may bill these calls.
import { loadCronDatabase } from '../../../lib/cron-auth';
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
// Recheck existing Chattanooga restaurants each run at no additional Places API cost.
// Only strong, explicit sports-viewing evidence is auto-published; ambiguous
// references to a TV, a bar, or a grill are not sufficient.
function sportsBarEvidence(v) {
  const name = String(v.name || '');
  const description = String(v.description || '');
  if (/\b(sports? bar|sports? pub|sports? grill)\b/i.test(name)) return 'explicit_sports_venue_name';
  if (/\b(sports? bar|sports? pub|sports? grill|dedicated sports viewing|watch (?:the |live )?games?|game.day watch parties|multiple (?:big.screen )?(?:tvs|televisions))\b/i.test(description))
    return 'explicit_sports_viewing_description';
  const reviews = Array.isArray(v.google_reviews) ? v.google_reviews : [];
  const matching = reviews.filter(r => /\b(watch(?:ed|ing)? (?:the |a )?(?:game|football|basketball|baseball)|sports bar|plenty of (?:tvs|televisions)|tvs? (?:everywhere|all around))\b/i.test(String(r?.text?.text || r?.text || '')));
  return matching.length >= 2 ? 'two_independent_sports_viewing_reviews' : null;
}
async function classifyChattanoogaSportsBars(supabaseAdmin) {
  const { data, error } = await supabaseAdmin.from('venues')
    .select('id,name,description,google_reviews,category,subcategory,categories,subcategories,is_claimed,is_hidden,is_private')
    .eq('city', 'Chattanooga').eq('category', 'restaurant').eq('is_claimed', false)
    .eq('is_hidden', false).eq('is_private', false).limit(1000);
  if (error) throw error;
  let updated = 0;
  const reviewCandidates = [];
  for (const v of data || []) {
    if ((v.categories || []).includes('nightlife') && (v.subcategories || []).includes('Sports Bar')) continue;
    const evidence = sportsBarEvidence(v);
    if (!evidence) {
      if (/\b(?:sports|game.day|televisions|tvs?)\b/i.test([v.name,v.description].join(' ')))
        reviewCandidates.push(v.name);
      continue;
    }
    const categories = [...new Set([...(v.categories || [v.category]), 'nightlife'])];
    const subcategories = [...new Set([...(v.subcategories || [v.subcategory]).filter(Boolean), 'Sports Bar'])];
    // Protect owner edits, and re-check the previous category membership.
    const { data: saved, error: saveError } = await supabaseAdmin.from('venues')
      .update({ categories, subcategories }).eq('id', v.id)
      .eq('is_claimed', false).eq('category', 'restaurant')
      .select('id');
    if (saveError) throw saveError;
    updated += saved?.length || 0;
  }
  return { updated, needsReview: reviewCandidates.slice(0, 20) };
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
  if (!process.env.GOOGLE_PLACES_KEY)
    return res.status(503).json({ status: 'missing_google_places_key' });
  const supabaseAdmin = await loadCronDatabase();
  if (!supabaseAdmin) return res.status(503).json({ status: 'cron_database_unavailable' });

  // Classification does not consume a Google search request. It continues
  // even if the separate discovery search budget is exhausted.
  let sportsBarAudit;
  try { sportsBarAudit = await classifyChattanoogaSportsBars(supabaseAdmin); }
  catch (error) { sportsBarAudit = { error: String(error.message).slice(0, 180) }; }

  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const monthStart = `${month}-01T00:00:00.000Z`;
  if (process.env.GOOGLE_PLACES_FREE_BUDGET_VERIFIED !== 'true')
    return res.json({ status: 'google_budget_not_verified', sportsBarAudit });
  const { data: snapshot, error: snapshotError } = await supabaseAdmin.from('google_api_budget_snapshots')
    .select('requests,captured_at').eq('month_utc', month).eq('sku', 'nearby_search_pro')
    .eq('source', 'google_cloud').order('captured_at', { ascending: false }).limit(1).maybeSingle();
  const snapshotTime = Date.parse(snapshot?.captured_at);
  if (snapshotError || !Number.isFinite(snapshotTime) || snapshotTime > now.getTime() ||
      now.getTime() - snapshotTime >= 6 * 3600000 || !Number.isSafeInteger(snapshot?.requests) || snapshot.requests < 0)
    return res.json({ status: 'google_budget_snapshot_unavailable', sportsBarAudit });
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  // Track our own API requests. This is a usage limit, NOT a guarantee of
  // zero Google Cloud charges (other clients can share the same API key).
  const [monthResult, dayResult] = await Promise.all([
    supabaseAdmin.from('restaurant_coverage_runs').select('api_calls,started_at').gte('started_at', monthStart),
    supabaseAdmin.from('restaurant_coverage_runs').select('api_calls').gte('started_at', dayStart.toISOString()),
  ]);
  if (monthResult.error || dayResult.error)
    return res.status(503).json({ status: 'usage_counter_unavailable' });
  const monthCalls = (monthResult.data || []).reduce((sum, r) => sum + (r.api_calls || 0), 0);
  const dayCalls = (dayResult.data || []).reduce((sum, r) => sum + (r.api_calls || 0), 0);
  const sinceSnapshot = (monthResult.data || []).filter(run => Date.parse(run.started_at) > snapshotTime)
    .reduce((sum, run) => sum + (run.api_calls || 0), 0);
  if (snapshot.requests + sinceSnapshot >= 4500)
    return res.json({ status: 'google_budget_target_reached', sportsBarAudit });
  if (monthCalls >= MONTHLY_LIMIT)
    return res.json({ status: 'monthly_limit_reached', monthlyLimit: MONTHLY_LIMIT, sportsBarAudit });
  if (dayCalls >= DAILY_LIMIT)
    return res.json({ status: 'daily_limit_reached', dailyLimit: DAILY_LIMIT, sportsBarAudit });

  // Recover stale interrupted tiles; attempts is the next category cursor (0..7).
  await supabaseAdmin.from('restaurant_coverage_tiles').update({ status: 'queued' })
    .eq('status', 'running').lt('started_at', new Date(now.getTime() - 15 * 60000).toISOString());
  const { data: tiles, error: tileError } = await supabaseAdmin
    .from('restaurant_coverage_tiles').select('id,lat,lng,radius_m,attempts,status,discovered,staged')
    .eq('status', 'queued').limit(1000);
  if (tileError) return res.status(503).json({ status: 'tile_query_failed' });
  const tile = (tiles || []).sort((a,b) => distance(a) - distance(b) || a.id - b.id)[0];
  if (!tile) return res.json({ status: 'all_tiles_processed', sportsBarAudit });
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
        supabaseAdmin.from('venues_pending').select('google_place_id,status').in('google_place_id', ids),
        supabaseAdmin.from('deleted_venues').select('google_place_id').in('google_place_id', ids),
      ]);
      if (live.error || pending.error || deleted.error) throw Error(live.error?.message || pending.error?.message || deleted.error?.message);
      const blocked = new Set([...(live.data || []), ...(deleted.data || [])].map(r => r.google_place_id));
      // Previously rejected places must stay excluded; approved/pending places
      // can be promoted automatically once, without overwriting curated venues.
      const pendingById = new Map((pending.data || []).map(r => [r.google_place_id, r]));
      const fresh = rows.filter(r => !blocked.has(r.google_place_id) && !pendingById.has(r.google_place_id));
      if (fresh.length) {
        const { error } = await supabaseAdmin.from('venues')
          .upsert(fresh.map(r => ({ ...r, source: 'google_places', is_verified: false })),
            { onConflict: 'google_place_id', ignoreDuplicates: true });
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
      classified: rows.length, addedToMap: staged, sportsBarAudit, categoryProgress: cursor + 1, categoriesPerTile: TYPES.length });
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
