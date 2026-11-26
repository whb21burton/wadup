import { loadCronDatabase } from '../../../lib/cron-auth';
import { readGoogleDiscoveryStatus } from '../../../lib/google-discovery-status';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  const credential = process.env.ADMIN_SYNC_PASSWORD;
  if (!credential || req.headers.authorization !== 'Bearer ' + credential) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const db = await loadCronDatabase();
  if (!db) return res.status(503).json({ error: 'Budget storage unavailable' });
  const [status, queues] = await Promise.all([
    readGoogleDiscoveryStatus(db),
    db.from('restaurant_coverage_tiles').select('id', { count:'exact', head:true }).eq('status','queued'),
  ]);
  if (queues.error) return res.status(503).json({ error:'Coverage storage unavailable' });
  const nearby = status.skus.find(sku=>sku.id==='99F9-A108-83A6');
  return res.json({ ...status, queued_tiles:queues.count, discovery_enabled:status.discoveryEligible,
    verified_sku_snapshot:status.feedAvailable, published_free_cap:nearby.freeCap, safety_reserve:nearby.reserve,
    operational_target:nearby.freeCap-nearby.reserve, snapshot_at:nearby.coveredThrough,
    remaining_to_target:status.feedAvailable?nearby.remaining:null,
    estimated_monthly_requests:nearby.reported==null?null:nearby.reported+(nearby.pending||0),
  });
}
