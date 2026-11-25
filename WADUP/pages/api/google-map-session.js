import {reserveGoogleApiUse} from '../../lib/google-api-admission';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method!=='POST') return res.status(405).end();
  let origin;
  try { origin=new URL(req.headers.origin); } catch { return res.status(403).end(); }
  if (origin.host!==req.headers.host || (origin.protocol!=='https:' && !['localhost','127.0.0.1'].includes(origin.hostname)))
    return res.status(403).end();
  if (!process.env.NEXT_PUBLIC_GMAPS_KEY || !await reserveGoogleApiUse('FAF4-3B2D-51B2'))
    return res.status(503).json({error:'Map usage is unavailable'});
  return res.status(204).end();
}
