// pages/api/places/photo.js — proxies Google Places (New) photo media so the
// API key never has to be exposed to the browser.
// GET /api/places/photo?ref=places/PLACE_ID/photos/PHOTO_ID&maxWidth=800
import {reserveGoogleApiUse} from '../../../lib/google-api-admission';

const REF_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { ref, maxWidth } = req.query;
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) {
    return res.status(400).json({ error: 'Invalid or missing photo ref' });
  }
  if (!process.env.GOOGLE_PLACES_KEY) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_KEY is not configured on the server' });
  }
  if (process.env.GOOGLE_LEGACY_CONTENT_APPROVED !== 'true' || !await reserveGoogleApiUse('DCD1-FE97-8C71'))
    return res.status(503).json({error:'Google photo access is unavailable'});

  const width = Math.min(Math.max(parseInt(maxWidth, 10) || 800, 1), 1600);
  const upstreamUrl = `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=${width}&key=${process.env.GOOGLE_PLACES_KEY}`;

  try {
    const upstream = await fetch(upstreamUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Photo fetch failed' });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Photo fetch failed' });
  }
}
