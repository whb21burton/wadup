import {reserveGoogleApiUse} from '../../lib/google-api-admission';
import {isMapTestDeployment, previewMapKey} from '../../lib/preview-map-access';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method!=='POST') return res.status(405).end();
  let origin;
  try { origin=new URL(req.headers.origin); } catch { return res.status(403).end(); }
  if (origin.host!==req.headers.host || (origin.protocol!=='https:' && !['localhost','127.0.0.1'].includes(origin.hostname)))
    return res.status(403).end();
  // Vercel Deployment Protection authenticates access to this Preview route.
  if (isMapTestDeployment(process.env)) {
    const key = previewMapKey(origin, process.env);
    if (!key) return res.status(503).json({error:'Preview Maps requires a restricted key and an active approved test window.'});
    return res.status(200).json({key});
  }
  if (!process.env.NEXT_PUBLIC_GMAPS_KEY)
    return res.status(503).json({error:'Google Maps is not configured for this deployment.'});
  if (!await reserveGoogleApiUse('FAF4-3B2D-51B2'))
    return res.status(503).json({error:'Map usage is unavailable'});
  return res.status(204).end();
}
