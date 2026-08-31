// pages/api/places/photo.js — proxies Google Places (New) photo media so the
// API key never has to be exposed to the browser.
// GET /api/places/photo?ref=places/PLACE_ID/photos/PHOTO_ID&maxWidth=800
const REF_PATTERN = /^places\/[^/]+\/photos\/[^/]+$/;

export default async function handler(req, res) {
  const { ref, maxWidth } = req.query;
  if (!ref || !REF_PATTERN.test(ref)) {
    return res.status(400).json({ error: 'Invalid or missing photo ref' });
  }
  if (!process.env.GOOGLE_PLACES_KEY) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_KEY is not configured on the server' });
  }

  const width = Math.min(Math.max(parseInt(maxWidth, 10) || 800, 1), 1600);
  const upstreamUrl = `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=${width}&key=${process.env.GOOGLE_PLACES_KEY}`;

  try {
    const upstream = await fetch(upstreamUrl);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Photo fetch failed' });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.status(200).send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Photo fetch failed' });
  }
}
