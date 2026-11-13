// Private Google Places budget status. Counts are estimates until SKU snapshots are available.
import { supabaseAdmin } from '../supabase-admin';
const FREE_CAP = 5000, TARGET = 4500, PRICE_PER_1000 = 32;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  if (!process.env.ADMIN_SYNC_PASSWORD ||
      req.headers.authorization !== 'Bearer ' + process.env.ADMIN_SYNC_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' });
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const [{ data: snapshots, error: e1 }, { data: runs, error: e2 }, { count: queued, error: e3 }] = await Promise.all([
    supabaseAdmin.from('google_api_budget_snapshots').select('*').eq('month_utc', month)
      .eq('sku', 'nearby_search_pro').eq('source', 'google_cloud')
      .order('captured_at', { ascending: false }).limit(1),
    supabaseAdmin.from('restaurant_coverage_runs').select('api_calls,started_at')
      .gte('started_at', month + '-01T00:00:00.000Z'),
    supabaseAdmin.from('restaurant_coverage_tiles').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
  ]);
  if (e1 || e2 || e3) return res.status(503).json({ error: e1?.message || e2?.message || e3?.message });
  const snapshot = snapshots?.[0] || null;
  const fresh = !!snapshot && now.getTime() - new Date(snapshot.captured_at).getTime() < 6 * 3600000;
  const pending = (runs || []).filter(r => !snapshot || new Date(r.started_at) > new Date(snapshot.captured_at))
    .reduce((sum, r) => sum + (r.api_calls || 0), 0);
  const estimated = snapshot ? snapshot.requests + pending : null;
  const remaining = estimated == null ? null : Math.max(0, TARGET - estimated);
  return res.json({ month, sku: 'Places API Nearby Search Pro', published_free_cap: FREE_CAP,
    operational_target: TARGET, safety_reserve: FREE_CAP - TARGET,
    verified_sku_snapshot: fresh, snapshot_at: snapshot?.captured_at || null,
    estimated_monthly_requests: estimated, remaining_to_target: remaining,
    queued_tiles: queued, discovery_enabled: fresh && process.env.GOOGLE_PLACES_FREE_BUDGET_VERIFIED === 'true',
    pricing: { currency: 'USD', extra_requests_per_1000: PRICE_PER_1000,
      examples: [{ additional_calls: 1000, estimated_cost: 32 },
        { additional_calls: 5000, estimated_cost: 160 },
        { additional_calls: 10000, estimated_cost: 320 }] },
    warning: 'Pricing assumes Pro-tier Nearby Search pay-as-you-go and no other billable SKUs. No hard zero-dollar spending guarantee.',
  });
}
