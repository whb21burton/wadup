// pages/api/geocode.js — Google Geocoding proxy
import {reserveGoogleApiUse} from '../../lib/google-api-admission';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();
  const { address, latlng } = req.query;
  const params = new URLSearchParams();
  if (typeof address === 'string' && address.trim() && address.length <= 300) params.set('address', address.trim());
  else if (typeof latlng === 'string' && /^-?\d{1,3}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?$/.test(latlng)) params.set('latlng',latlng);
  else return res.status(400).json({error:'A valid address or coordinates are required'});
  const key = process.env.GMAPS_KEY;
  if (!key) return res.status(503).json({ error: 'Geocoding is not configured' });
  if (!await reserveGoogleApiUse('BAC8-4E68-E261')) return res.status(503).json({error:'Geocoding budget unavailable'});

  params.set('key',key);

  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    const data = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
