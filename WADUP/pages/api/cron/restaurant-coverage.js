// Persistent, resumable restaurant coverage worker.
// Can run every 15 minutes once verified billing snapshots are available; one geographic tile per
// invocation to stay within Vercel's serverless duration limits.
// IMPORTANT: GOOGLE_PLACES_FREE_BUDGET_VERIFIED=true must be set only after
// verifying a real enforced $0 spending guard outside this app. A request
// count is NOT a reliable Google Cloud billing cap.
import { supabaseAdmin } from '../supabase-admin';
import { searchNearby, mapPlaceToRow, isChain, isBlockedPrimaryType } from '../../../lib/placesSync';

export const config = { maxDuration: 60 };
const TYPES = ['restaurant', 'cafe', 'bakery'];
const MONTHLY_FREE_PRO = 5000;
const MONTHLY_TARGET_PRO = 4500; // reserve 500 for unrelated searches, reporting delay and errors
const maxCallsPerDay = 150; // spread 4,500 requests over a 30-day month

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  if (!process.env.CRON_SECRET ||
      req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: 'Unauthorized' });

  // Never trust our own scan count as total Google usage. Only a fresh,
  // authoritative billing-SKU snapshot may unlock a scan. A Google Cloud
  // API-level request total is NOT a substitute for SKU usage.
  if (process.env.GOOGLE_PLACES_FREE_BUDGET_VERIFIED !== 'true')
    return res.json({ status: 'paused_unverified_free_api_limit', queued: true });
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const { data: snapshots, error: snapshotError } = await supabaseAdmin
    .from('google_api_budget_snapshots').select('requests,captured_at')
    .eq('month_utc', month).eq('sku', 'nearby_search_pro')
    .eq('source', 'google_cloud').order('captured_at', { ascending: false }).limit(1);
  if (snapshotError) return res.status(503).json({ status: 'billing_snapshot_unavailable' });
  const snapshot = snapshots?.[0];
  if (!snapshot || now.getTime() - new Date(snapshot.captured_at).getTime() > 6 * 3600000)
    return res.json({ status: 'paused_missing_fresh_sku_usage', queued: true });
  const monthStart = month + '-01T00:00:00.000Z';
  const { data: monthRuns, error: monthError } = await supabaseAdmin
    .from('restaurant_coverage_runs').select('api_calls,started_at')
    .gte('started_at', monthStart);
  if (monthError) return res.status(503).json({ status: 'monthly_usage_unavailable' });
  const afterSnapshot = (monthRuns || []).filter(r =>
    new Date(r.started_at).getTime() > new Date(snapshot.captured_at).getTime())
    .reduce((sum, r) => sum + (r.api_calls || 0), 0);
  const projectedUsage = snapshot.requests + afterSnapshot + TYPES.length;
  if (projectedUsage > MONTHLY_TARGET_PRO)
    return res.json({ status: 'monthly_free_headroom_reserved',
      estimated_used: snapshot.requests + afterSnapshot,
      target: MONTHLY_TARGET_PRO, published_free_cap: MONTHLY_FREE_PRO });

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: runs, error: runError } = await supabaseAdmin
    .from('restaurant_coverage_runs').select('api_calls')
    .gte('started_at', dayStart.toISOString());
  if (runError) return res.status(500).json({ error: runError.message });
  const used = (runs || []).reduce((sum, r) => sum + (r.api_calls || 0), 0);
  if (used + TYPES.length > maxCallsPerDay)
    return res.json({ status: 'daily_request_cap_reached', used });

  // Recover interrupted runs; an old running tile must not get stuck.
  await supabaseAdmin.from('restaurant_coverage_tiles')
    .update({ status: 'queued' }).eq('status', 'running')
    .lt('started_at', new Date(Date.now() - 15 * 60000).toISOString());
  const { data: tiles, error: tileError } = await supabaseAdmin
    .from('restaurant_coverage_tiles').select('*').eq('status', 'queued')
    .order('id', { ascending: true }).limit(1);
  if (tileError) return res.status(500).json({ error: tileError.message });
  const tile = tiles?.[0];
  if (!tile) return res.json({ status: 'all_tiles_processed' });
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('restaurant_coverage_tiles')
    .update({ status: 'running', started_at: new Date().toISOString(), attempts: tile.attempts + 1 })
    .eq('id', tile.id).eq('status', 'queued').select('id');
  if (claimError || !claimed?.length)
    return res.status(409).json({ error: claimError?.message || 'Tile already claimed' });

  const { data: run, error: insertError } = await supabaseAdmin
    .from('restaurant_coverage_runs').insert({ tile_id: tile.id, api_calls: TYPES.length })
    .select('id').single();
  if (insertError) return res.status(500).json({ error: insertError.message });

  let discovered = 0, staged = 0;
  try {
    const byId = new Map();
    for (const type of TYPES) {
      const places = await searchNearby([type], {
        lat: tile.lat, lng: tile.lng, radius: tile.radius_m,
      });
      for (const place of places) {
        if (!place.id || !place.location || isChain(place.displayName?.text) ||
            isBlockedPrimaryType(place.primaryType) ||
            place.primaryType === 'ice_cream_shop') continue;
        if (!byId.has(place.id)) byId.set(place.id, mapPlaceToRow(place, 'restaurant'));
      }
    }
    const rows = [...byId.values()];
    discovered = rows.length;
    if (rows.length) {
      const ids = rows.map(x => x.google_place_id);
      const [{ data: live, error: e1 }, { data: pending, error: e2 },
        { data: deleted, error: e3 }] = await Promise.all([
        supabaseAdmin.from('venues').select('google_place_id').in('google_place_id', ids),
        supabaseAdmin.from('venues_pending').select('google_place_id').in('google_place_id', ids),
        supabaseAdmin.from('deleted_venues').select('google_place_id').in('google_place_id', ids),
      ]);
      if (e1 || e2 || e3) throw new Error(e1?.message || e2?.message || e3?.message);
      const known = new Set([...(live || []), ...(pending || []), ...(deleted || [])]
        .map(x => x.google_place_id));
      const fresh = rows.filter(x => !known.has(x.google_place_id));
      if (fresh.length) {
        const { error } = await supabaseAdmin.from('venues_pending')
          .upsert(fresh.map(x => ({ ...x, status: 'pending' })),
            { onConflict: 'google_place_id' });
        if (error) throw error;
        staged = fresh.length;
      }
    }
    await supabaseAdmin.from('restaurant_coverage_tiles')
      .update({ status: 'done', discovered, staged,
        completed_at: new Date().toISOString(), last_error: null }).eq('id', tile.id);
    await supabaseAdmin.from('restaurant_coverage_runs')
      .update({ status: 'done', discovered, staged, finished_at: new Date().toISOString() })
      .eq('id', run.id);
    return res.json({ status: 'done', tile: tile.id, discovered, staged,
      remaining: 'query restaurant_coverage_tiles for progress' });
  } catch (e) {
    await supabaseAdmin.from('restaurant_coverage_tiles')
      .update({ status: 'error', last_error: String(e.message).slice(0, 500),
        completed_at: new Date().toISOString() }).eq('id', tile.id);
    await supabaseAdmin.from('restaurant_coverage_runs')
      .update({ status: 'error', error: String(e.message).slice(0, 500),
        finished_at: new Date().toISOString() }).eq('id', run.id);
    return res.status(500).json({ status: 'error', tile: tile.id, error: e.message });
  }
}
