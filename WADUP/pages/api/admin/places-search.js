// pages/api/admin/places-search.js — Google Places (New) Text Search, used
// by the Add Venue modal's "Search Google Places" option.
import { requireAdmin } from './_authAdmin';

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.regularOpeningHours', 'places.photos', 'places.primaryType',
].join(',');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });

  if (!process.env.GOOGLE_PLACES_KEY) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_KEY is not configured on the server' });
  }

  const { venueName, city, state } = req.body || {};
  if (!venueName) return res.status(400).json({ error: 'Missing venueName' });

  const textQuery = [venueName, city, state].filter(Boolean).join(' ');

  try {
    const upstream = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.error?.message || 'Places search failed' });
    }

    const results = (data.places || []).map(place => {
      const photoName = place.photos?.[0]?.name;
      return {
        google_place_id: place.id,
        name: place.displayName?.text || 'Unnamed venue',
        address: (place.formattedAddress || '').split(',')[0]?.trim() || null,
        formattedAddress: place.formattedAddress || '',
        lat: place.location?.latitude ?? null,
        lng: place.location?.longitude ?? null,
        phone: place.internationalPhoneNumber || null,
        website: place.websiteUri || null,
        subcategory: place.primaryType ? place.primaryType.replace(/_/g, ' ') : null,
        google_rating: place.rating ?? null,
        google_review_count: place.userRatingCount ?? null,
        cover_photo_url: photoName ? `/api/places/photo?ref=${encodeURIComponent(photoName)}&maxWidth=800` : null,
        hours: place.regularOpeningHours || null,
      };
    });

    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: 'Places search failed' });
  }
}
