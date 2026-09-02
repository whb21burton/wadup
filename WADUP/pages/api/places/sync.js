// pages/api/places/sync.js — pulls real Chattanooga venues from Google
// Places API (New). NEVER writes a new venue straight to the live `venues`
// table: a place Google returns that isn't already an approved venue lands
// in `venues_pending` for an admin to approve/reject (see
// pages/admin/venues.js's Pending Approval tab, and approve-venue.js/
// reject-venue.js). Already-approved venues just get their Google-sourced
// fields refreshed. Keyed on google_place_id throughout, so re-running this
// never creates duplicates in either table.
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

// WadUp is meant to surface local/independent spots, not national chains —
// skip any place whose name matches one of these (case-insensitive substring).
const CHAIN_BLOCKLIST = [
  'mcdonald', 'taco bell', 'burger king', 'wendy', 'chick-fil-a', 'subway',
  'domino', 'pizza hut', 'papa john', 'kfc', 'popeyes', 'sonic', 'arby',
  'cracker barrel', 'buffalo wild wings', 'applebee', 'chili', 'olive garden',
  'red lobster', 'ihop', 'denny', 'waffle house', 'starbucks', 'dunkin',
  'walmart', 'target', 'costco', 'whole foods', 'publix', 'kroger', 'aldi',
  'cvs', 'walgreen', 'dollar', 'chuck e cheese',
  'holiday inn', 'marriott', 'hilton', 'hyatt', 'hampton inn', 'best western',
  'comfort inn', 'days inn', 'super 8', 'motel 6', 'brothers bagel',
  'panera', 'chipotle', 'panda express', 'five guys', 'shake shack',
  'in-n-out', 'whataburger', 'cook out', 'hardee', 'jack in the box',
  'little caesar', 'papa murphy', 'jersey mike', 'jimmy john', 'firehouse',
  'wingstop', 'raising cane', 'zaxby', 'golden corral', 'longhorn',
  'texas roadhouse', 'outback', 'red robin', 'hooters', 'dennys', 'bob evan',
  'amc ', 'amc classic', 'amc majestic', 'amc northgate', 'amc dine-in',
  'regal cinema', 'cinemark', 'marcus theater', 'landmark cinema',
  'barnes & noble', "dick's sporting", 'academy sports',
  'planet fitness', 'la fitness', 'anytime fitness', "gold's gym",
  'great clips', 'sport clips', 'supercuts',
  'quality inn', 'ramada',
];

function isChain(name) {
  const lower = (name || '').toLowerCase();
  return CHAIN_BLOCKLIST.some(chain => lower.includes(chain));
}

const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.regularOpeningHours', 'places.photos', 'places.primaryType',
  'places.types',
].join(',');

// A lot of bars/taverns/breweries get typed by Google as "restaurant" (their
// primaryType) with the bar-ish signal only showing up elsewhere in their
// broader `types` list (or as a specific primaryType like "bar_and_grill") —
// meaning they'd only ever surface from the SEARCH_TYPES restaurant query
// above and get stuck with wadupCat 'restaurant', never the nightlife one.
// This overrides that per-search-group default using the place's OWN type
// data, so it doesn't matter which searchNearby call actually returned it.
const NIGHTLIFE_TYPES = ['bar', 'night_club', 'pub', 'brewery', 'wine_bar', 'cocktail_bar', 'sports_bar', 'tavern', 'lounge'];

function resolveWadupCat(place, searchGroupCat) {
  const primary = (place.primaryType || '').toLowerCase();
  const allTypes = (place.types || []).map(t => t.toLowerCase());
  const isNightlife = NIGHTLIFE_TYPES.some(n => primary.includes(n) || allTypes.some(t => t.includes(n)));
  return isNightlife ? 'nightlife' : searchGroupCat;
}

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
    categories: [wadupCat],
    category: wadupCat, // legacy single-value fallback — only used on insert; never re-applied to existing venues (see the update payloads below)
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
    custom_cover_photo: false,
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
  let skippedChains = 0;

  for (let i = 0; i < SEARCH_TYPES.length; i++) {
    const { types, wadupCat } = SEARCH_TYPES[i];
    if (i > 0) await new Promise(r => setTimeout(r, 200)); // light throttle between requests
    try {
      const places = await searchNearby(types);
      places.forEach(place => {
        if (!place.id || byPlaceId.has(place.id)) return; // first matching group wins
        if (isChain(place.displayName?.text)) { skippedChains++; return; }
        const resolvedCat = resolveWadupCat(place, wadupCat);
        byCategory[resolvedCat] = (byCategory[resolvedCat] || 0) + 1;
        byPlaceId.set(place.id, mapPlaceToRow(place, resolvedCat));
      });
    } catch (e) {
      errors.push(`${types.join('/')}: ${e.message}`);
    }
  }

  const allRows = [...byPlaceId.values()];
  if (!allRows.length) {
    return res.status(200).json({ success: true, added_to_queue: 0, already_live: 0, skipped: 0, totalFetched: 0, byCategory, skippedChains, errors });
  }

  // Three exclusion lists, checked before anything touches `venues` or
  // `venues_pending`:
  //   - deleted_venues: an admin permanently deleted this place (delete-venue.js)
  //   - venues (already exists): already approved and live — never re-queued,
  //     only refreshed
  //   - venues_pending with status 'rejected': an admin already reviewed and
  //     rejected it, so it must not silently reappear in the queue
  const placeIds = allRows.map(r => r.google_place_id);
  const [
    { data: deletedRows, error: deletedError },
    { data: liveRowsRaw, error: liveError },
    { data: pendingRowsRaw, error: pendingError },
  ] = await Promise.all([
    supabaseAdmin.from('deleted_venues').select('google_place_id').in('google_place_id', placeIds),
    supabaseAdmin.from('venues').select('google_place_id, custom_cover_photo, name').in('google_place_id', placeIds),
    supabaseAdmin.from('venues_pending').select('google_place_id, status').in('google_place_id', placeIds),
  ]);
  if (deletedError) return res.status(500).json({ error: 'Failed to read deleted_venues blocklist', detail: deletedError.message });
  if (liveError) return res.status(500).json({ error: 'Failed to read existing venues', detail: liveError.message });
  if (pendingError) return res.status(500).json({ error: 'Failed to read venues_pending', detail: pendingError.message });

  const deletedIds = new Set((deletedRows || []).map(r => r.google_place_id));
  const liveByPlaceId = new Map((liveRowsRaw || []).map(r => [r.google_place_id, r]));
  const rejectedIds = new Set((pendingRowsRaw || []).filter(r => r.status === 'rejected').map(r => r.google_place_id));
  const alreadyPendingIds = new Set((pendingRowsRaw || []).filter(r => r.status !== 'rejected').map(r => r.google_place_id));

  let skipped = 0;
  const liveUpdateCandidates = [];
  const pendingCandidates = [];
  for (const row of allRows) {
    const id = row.google_place_id;
    if (deletedIds.has(id) || rejectedIds.has(id)) { skipped++; continue; }
    if (liveByPlaceId.has(id)) { liveUpdateCandidates.push(row); continue; }
    pendingCandidates.push(row);
  }

  const nowIso = new Date().toISOString();

  // Already-live venues: sync NEVER adds a venue straight to the map — this
  // is purely a refresh of Google-sourced fields (rating, review count,
  // hours, and — unless the admin uploaded their own — the cover photo).
  // Every admin-curated field (name, custom_emoji, categories/category,
  // is_hidden, is_private, is_verified, hide_new_badge, description,
  // subcategory, custom_subcategories, weighted_rating) is left completely
  // untouched: it's simply never included in the update payload below.
  // Split by custom_cover_photo so each upsert batch has a consistent set of
  // columns — PostgREST fills any column omitted from a row (but present on
  // a sibling row in the same batch) with NULL, so mixing the two shapes in
  // one call would blank out cover_photo_url on the venues we mean to protect.
  // `name` is NOT NULL with no default, so PostgREST's upsert would fail the
  // NOT NULL check on its implicit insert branch if it were left out — even
  // though these rows always hit the ON CONFLICT DO UPDATE path. Echoing back
  // each venue's own current name satisfies the constraint as a harmless
  // `name = name` no-op without ever applying Google's name to an existing venue.
  const refreshPhotoRows = liveUpdateCandidates
    .filter(r => !liveByPlaceId.get(r.google_place_id).custom_cover_photo)
    .map(r => ({
      google_place_id: r.google_place_id,
      name: liveByPlaceId.get(r.google_place_id).name,
      google_rating: r.google_rating,
      google_review_count: r.google_review_count,
      hours: r.hours,
      cover_photo_url: r.cover_photo_url,
      last_google_sync: nowIso,
    }));
  const keepPhotoRows = liveUpdateCandidates
    .filter(r => liveByPlaceId.get(r.google_place_id).custom_cover_photo)
    .map(r => ({
      google_place_id: r.google_place_id,
      name: liveByPlaceId.get(r.google_place_id).name,
      google_rating: r.google_rating,
      google_review_count: r.google_review_count,
      hours: r.hours,
      last_google_sync: nowIso,
    }));

  if (refreshPhotoRows.length) {
    const { error } = await supabaseAdmin.from('venues').upsert(refreshPhotoRows, { onConflict: 'google_place_id' });
    if (error) return res.status(500).json({ error: 'Update failed', detail: error.message });
  }
  if (keepPhotoRows.length) {
    const { error } = await supabaseAdmin.from('venues').upsert(keepPhotoRows, { onConflict: 'google_place_id' });
    if (error) return res.status(500).json({ error: 'Update failed', detail: error.message });
  }

  // Everything else — a place never seen before, or one still sitting in the
  // pending queue from an earlier sync — is (re-)upserted into
  // venues_pending for an admin to review via the Pending Approval tab. This
  // is the ONLY path that can introduce a new venue from Google; sync never
  // writes a brand-new row directly into the live `venues` table anymore.
  // `is_claimed`/`custom_cover_photo` aren't columns on venues_pending at
  // all, so they're stripped before the upsert.
  const pendingRowsToUpsert = pendingCandidates.map(({ is_claimed, custom_cover_photo, ...pendingFields }) => ({
    ...pendingFields,
    status: 'pending',
  }));
  const addedToQueue = pendingCandidates.filter(r => !alreadyPendingIds.has(r.google_place_id)).length;

  if (pendingRowsToUpsert.length) {
    const { error } = await supabaseAdmin.from('venues_pending').upsert(pendingRowsToUpsert, { onConflict: 'google_place_id' });
    if (error) return res.status(500).json({ error: 'Pending queue upsert failed', detail: error.message });
  }

  return res.status(200).json({
    success: true,
    added_to_queue: addedToQueue,
    already_live: liveUpdateCandidates.length,
    skipped,
    totalFetched: allRows.length,
    byCategory,
    skippedChains,
    errors,
  });
}
