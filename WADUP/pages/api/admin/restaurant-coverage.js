import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { isSuperAdmin } from '../../../lib/admin';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  const auth = await requireAdmin(req);
  if (!auth || !isSuperAdmin(auth.adminRole))
    return res.status(403).json({ error: 'Super admin access required' });
  res.setHeader('Cache-Control', 'private, no-store');
  const [tiles, runs, pending, restaurants] = await Promise.all([
    supabaseAdmin.from('restaurant_coverage_tiles')
      .select('id,region,status,attempts,discovered,staged,last_error,completed_at,lat,lng')
      .order('id', { ascending: true }).limit(1500),
    supabaseAdmin.from('restaurant_coverage_runs')
      .select('id,tile_id,started_at,finished_at,status,api_calls,discovered,staged,error')
      .order('started_at', { ascending: false }).limit(100),
    supabaseAdmin.from('venues_pending').select('id', { count: 'exact', head: true })
      .or('status.eq.pending,status.is.null'),
    supabaseAdmin.from('venues').select('id', { count: 'exact', head: true })
      .eq('category', 'restaurant').eq('is_hidden', false),
  ]);
  const error = [tiles.error, runs.error, pending.error, restaurants.error]
    .find(Boolean);
  if (error) return res.status(500).json({ error: error.message });
  const list = tiles.data || [], history = runs.data || [];
  const counts = { queued: 0, running: 0, done: 0, error: 0 };
  for (const tile of list) counts[tile.status] = (counts[tile.status] || 0) + 1;
  const regions = Object.values(list.reduce((acc, tile) => {
    const region = tile.region || 'Other';
    const row = acc[region] ||= { name: region, queued: 0, running: 0, done: 0, error: 0, staged: 0 };
    row[tile.status] = (row[tile.status] || 0) + 1;
    row.staged += tile.staged || 0;
    return acc;
  }, {}));
  return res.json({
    generatedAt: new Date().toISOString(),
    counts, totalTiles: list.length, regions,
    pendingCount: pending.count || 0,
    restaurantCount: restaurants.count || 0,
    stagedFromCoverage: list.reduce((s, t) => s + (t.staged || 0), 0),
    discoveredFromCoverage: list.reduce((s, t) => s + (t.discovered || 0), 0),
    recentRuns: history.slice(0, 30),
    errors: list.filter(t => t.status === 'error').slice(0, 20)
      .map(t => ({ id: t.id, region: t.region, message: t.last_error })),
    billingGuard: 'Google Places imports remain disabled until a verified no-charge protection is configured',
  });
}
