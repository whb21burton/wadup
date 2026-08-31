// pages/api/places/sync.js — pulls real Chattanooga venues from Google
// Places API (New) and upserts them into Supabase's `venues` table, keyed
// on google_place_id so re-running this never creates duplicates.
import { supabaseAdmin } from '../supabase-admin';

const CHATTANOOGA_CENTER = { lat: 35.0456, lng: -85.3096 };
const RADIUS_METERS = 20000; // 20km covers greater Chattanooga

const SEARCH_TYPES = [
  { types: ['bar', 'night_club', 'pub'],                        wadupCat: 'nightlife' },
  // 'food' isn't a real Places API (New) type (it's a legacy-API-only value) —
  // Google rejects the whole request when it's included. Split restaurant
  // coverage across its actual New-API subtypes instead.
  { types: ['restaurant'],                                      wadupCat: 'restaurant' },
  { types: ['cafe'],                                            wadupCat: 'restaurant' },
  { types: ['bakery'],                                          wadupCat: 'restaurant' },
  { types: ['meal_takeaway'],                                   wadupCat: 'restaurant' },
  { types: ['live_music_venue', 'concert_hall'],                wadupCat: 'events' },
  { types: ['bowling_alley', 'golf_course', 'amusement_center'],wadupCat: 'activities' },
  { types: ['park', 'campground', 'hiking_area'],                wadupCat: 'outdoors' },
  { types: ['stadium', 'sports_complex', 'athletic_field'],      wadupCat: 'sports' },
  { types: ['movie_theater', 'comedy_club'],                     wadupCat: 'events' },
];

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.regularOpeningHours', 'places.photos', 'places.primaryType',
].join(',');

async function searchNearby(types) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: types,
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: CHATTANOOGA_CENTER.lat, longitude: CHATTANOOGA_CENTER.lng },
          radius: RADIUS_METERS,
        },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Places API error (${res.status})`);
  return data.places || [];
}

// Search results are scoped to a 20km circle around Chattanooga, but
// Google's formattedAddress free text can list a neighboring town (East
// Ridge, Red Bank, Hixson…) — hardcoding city/state keeps every synced
// venue matching the map's `.eq('city', 'Chattanooga')` query.
function mapPlaceToRow(place, wadupCat) {
  const streetAddress = (place.formattedAddress || '').split(',')[0]?.trim() || null;
  const photoName = place.photos?.[0]?.name; // "places/PLACE_ID/photos/PHOTO_ID"

  return {
    google_place_id: place.id,
    name: place.displayName?.text || 'Unnamed venue',
    address: streetAddress,
    city: 'Chattanooga',
    state: 'TN',
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    phone: place.internationalPhoneNumber || null,
    website: place.websiteUri || null,
    category: wadupCat,
    // Google's specific type (e.g. "italian_restaurant") as a free-text
    // subcategory — more specific than the broad wadupCat bucket, and
    // already fetched via the field mask below, so no extra API cost.
    subcategory: place.primaryType ? place.primaryType.replace(/_/g, ' ') : null,
    google_rating: place.rating ?? null,
    google_review_count: place.userRatingCount ?? null,
    cover_photo_url: photoName ? `/api/places/photo?ref=${encodeURIComponent(photoName)}&maxWidth=800` : null,
    hours: place.regularOpeningHours || null,
    is_claimed: false,
    source: 'google_places',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ADMIN_SYNC_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_SYNC_PASSWORD is not configured on the server' });
  }
  if (req.headers['x-admin-password'] !== process.env.ADMIN_SYNC_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password' });
  }
  if (!process.env.GOOGLE_PLACES_KEY) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_KEY is not configured on the server' });
  }

  const byCategory = {};
  const errors = [];
  const byPlaceId = new Map(); // dedupe places matched by more than one type group

  for (let i = 0; i < SEARCH_TYPES.length; i++) {
    const { types, wadupCat } = SEARCH_TYPES[i];
    if (i > 0) await new Promise(r => setTimeout(r, 200)); // light throttle between requests
    try {
      const places = await searchNearby(types);
      byCategory[wadupCat] = (byCategory[wadupCat] || 0) + places.length;
      places.forEach(place => {
        if (!place.id || byPlaceId.has(place.id)) return; // first matching group wins
        byPlaceId.set(place.id, mapPlaceToRow(place, wadupCat));
      });
    } catch (e) {
      errors.push(`${types.join('/')}: ${e.message}`);
    }
  }

  const rows = [...byPlaceId.values()];
  if (!rows.length) {
    return res.status(200).json({ success: true, added: 0, updated: 0, totalFetched: 0, byCategory, errors });
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('venues')
    .select('google_place_id')
    .in('google_place_id', rows.map(r => r.google_place_id));
  if (existingError) {
    return res.status(500).json({ error: 'Failed to read existing venues', detail: existingError.message });
  }
  const existingIds = new Set((existing || []).map(r => r.google_place_id));
  const added = rows.filter(r => !existingIds.has(r.google_place_id)).length;
  const updated = rows.length - added;

  const { error: upsertError } = await supabaseAdmin
    .from('venues')
    .upsert(rows, { onConflict: 'google_place_id' });
  if (upsertError) {
    return res.status(500).json({ error: 'Upsert failed', detail: upsertError.message });
  }

  return res.status(200).json({
    success: true,
    added,
    updated,
    totalFetched: rows.length,
    byCategory,
    errors,
  });
}
