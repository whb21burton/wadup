// pages/api/places/photo.js — proxies Google Places (New) photo media so the
// API key never has to be exposed to the browser.
// GET /api/places/photo?ref=places/PLACE_ID/photos/PHOTO_ID&maxWidth=800
const REF_PATTERN = /^places\/[^/]+\/photos\/[^/]+$/;

export default async function handler(req, res) {
  const { ref, placeId, maxWidth } = req.query;
  // Place ID fallback for existing venues with no stored photo refs.
  // Never accept arbitrary URLs or forward an API key to the client.
  if ((!ref || !REF_PATTERN.test(ref)) && (!placeId || !/^[A-Za-z0-9_-]{10,200}$/.test(placeId))) {
    return res.status(400).json({ error: 'Invalid or missing photo reference' });
  }
  if (!process.env.GOOGLE_PLACES_KEY) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_KEY is not configured on the server' });
  }

  const width = Math.min(Math.max(parseInt(maxWidth, 10) || 800, 1), 1600);
  try {
    let photoRef = ref && REF_PATTERN.test(ref) ? ref : null;
    if (!photoRef) {
      const details = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        headers: { 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': 'photos' },
      });
      if (!details.ok) return res.status(404).json({ error: 'Place photo unavailable' });
      const place = await details.json();
      photoRef = place.photos?.[0]?.name;
      if (!photoRef || !REF_PATTERN.test(photoRef)) return res.status(404).json({ error: 'No photo for this place' });
    }
    const upstreamUrl = `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${width}&key=${process.env.GOOGLE_PLACES_KEY}`;
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
