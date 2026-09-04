// pages/api/places/sync.js — pulls real Chattanooga venues from Google
// Places API (New). NEVER writes a new venue straight to the live `venues`
// table: a place Google returns that isn't already an approved venue lands
// in `venues_pending` for an admin to approve/reject (see
// pages/admin/venues.js's Pending Approval tab, and approve-venue.js/
// reject-venue.js). Already-approved venues just get their Google-sourced
// fields refreshed. Keyed on google_place_id throughout, so re-running this
// never creates duplicates in either table.
import { supabaseAdmin } from '../supabase-admin';

// Every combination of SEARCH_GROUPS × SEARCH_CENTERS below is its own
// Google Places API call (56 groups × 5 centers = 280 calls per sync run).
// That's a deliberate, real cost/time tradeoff for comprehensive coverage —
// each single-type search only gets Google's 20-result cap to itself
// (rather than sharing it across several types bundled into one call), and
// each of the 5 overlapping search circles gives Google's ranking a
// different, smaller candidate pool to pick its "top 20" from, surfacing
// venues that would otherwise get crowded out by one city-wide search.
// Flag this to whoever's paying the Google Cloud bill before running it
// often — this is roughly 40x the call volume of the sync it replaces.
const SEARCH_CENTERS = [
  { lat: 35.0456, lng: -85.3096, radius: 15000 }, // Downtown Chattanooga
  { lat: 35.0456, lng: -85.3096, radius: 8000 },  // Inner downtown, tighter search
  { lat: 35.0200, lng: -85.2200, radius: 10000 }, // Hamilton Place / East Brainerd
  { lat: 35.0700, lng: -85.3000, radius: 8000 },  // North Shore / Hixson
  { lat: 35.0300, lng: -85.3300, radius: 8000 },  // Lookout Mountain / Southside
];

// Listed nightlife-first, then restaurants, then events/sports/outdoors/
// activities — a place matching more than one group's type (rare, but
// possible for a hybrid venue) is assigned to whichever group appears
// FIRST here, via the byPlaceId dedup in the handler below. Not every one
// of these type strings is guaranteed to be a currently-valid Places API
// (New) type; an invalid one just fails that one call (caught, logged to
// `errors`) without affecting any other search.
const SEARCH_GROUPS = [
  // Bars & Nightlife — comprehensive
  { types: ['bar'],                    wadupCat: 'nightlife' },
  { types: ['night_club'],             wadupCat: 'nightlife' },
  { types: ['pub'],                    wadupCat: 'nightlife' },
  { types: ['brewery'],                wadupCat: 'nightlife' },
  { types: ['wine_bar'],               wadupCat: 'nightlife' },
  { types: ['cocktail_bar'],           wadupCat: 'nightlife' },
  { types: ['sports_bar'],             wadupCat: 'nightlife' },
  { types: ['karaoke'],                wadupCat: 'nightlife' },
  { types: ['dance_hall'],             wadupCat: 'nightlife' },

  // Restaurants — comprehensive. 'food' isn't a real Places API (New) type
  // (it's a legacy-API-only value) — Google rejects the whole request when
  // it's included, so restaurant coverage is split across real subtypes.
  { types: ['restaurant'],             wadupCat: 'restaurant' },
  { types: ['american_restaurant'],    wadupCat: 'restaurant' },
  { types: ['italian_restaurant'],     wadupCat: 'restaurant' },
  { types: ['mexican_restaurant'],     wadupCat: 'restaurant' },
  { types: ['chinese_restaurant'],     wadupCat: 'restaurant' },
  { types: ['japanese_restaurant'],    wadupCat: 'restaurant' },
  { types: ['thai_restaurant'],        wadupCat: 'restaurant' },
  { types: ['seafood_restaurant'],     wadupCat: 'restaurant' },
  { types: ['steak_house'],            wadupCat: 'restaurant' },
  { types: ['pizza_restaurant'],       wadupCat: 'restaurant' },
  { types: ['sandwich_shop'],          wadupCat: 'restaurant' },
  { types: ['hamburger_restaurant'],   wadupCat: 'restaurant' },
  { types: ['bbq_restaurant'],         wadupCat: 'restaurant' },
  { types: ['brunch_restaurant'],      wadupCat: 'restaurant' },
  { types: ['breakfast_restaurant'],   wadupCat: 'restaurant' },
  { types: ['cafe'],                   wadupCat: 'restaurant' },
  { types: ['coffee_shop'],            wadupCat: 'restaurant' },
  { types: ['bakery'],                 wadupCat: 'restaurant' },
  { types: ['ice_cream_shop'],         wadupCat: 'restaurant' },
  { types: ['food_court'],             wadupCat: 'restaurant' },

  // Events & Entertainment
  { types: ['concert_hall'],           wadupCat: 'events' },
  { types: ['event_venue'],            wadupCat: 'events' },
  { types: ['live_music_venue'],       wadupCat: 'events' },
  { types: ['comedy_club'],            wadupCat: 'events' },
  { types: ['movie_theater'],          wadupCat: 'events' },
  { types: ['performing_arts_theater'],wadupCat: 'events' },
  { types: ['cultural_center'],        wadupCat: 'events' },
  { types: ['art_gallery'],            wadupCat: 'events' },
  { types: ['museum'],                 wadupCat: 'events' },

  // Sports
  { types: ['stadium'],                wadupCat: 'sports' },
  { types: ['sports_complex'],         wadupCat: 'sports' },
  { types: ['athletic_field'],         wadupCat: 'sports' },
  { types: ['sports_club'],            wadupCat: 'sports' },

  // Outdoors
  { types: ['park'],                   wadupCat: 'outdoors' },
  { types: ['national_park'],          wadupCat: 'outdoors' },
  { types: ['hiking_area'],            wadupCat: 'outdoors' },
  { types: ['campground'],             wadupCat: 'outdoors' },
  { types: ['boat_rental'],            wadupCat: 'outdoors' },
  { types: ['kayaking_area'],          wadupCat: 'outdoors' },
  { types: ['rock_climbing'],          wadupCat: 'outdoors' },

  // Activities
  { types: ['bowling_alley'],          wadupCat: 'activities' },
  { types: ['golf_course'],            wadupCat: 'activities' },
  { types: ['miniature_golf_course'],  wadupCat: 'activities' },
  { types: ['amusement_center'],       wadupCat: 'activities' },
  { types: ['escape_room'],            wadupCat: 'activities' },
  { types: ['axe_throwing'],           wadupCat: 'activities' },
  { types: ['laser_tag'],              wadupCat: 'activities' },
  { types: ['go_kart_track'],          wadupCat: 'activities' },
  { types: ['billiards'],              wadupCat: 'activities' },
];

// Bounded-concurrency task runner — 280 sequential API calls (even with a
// light throttle) would very plausibly blow past a serverless function's
// execution timeout. Running a handful in parallel keeps total wall time
// low while still respecting Google's per-key rate limits. `results[i]` is
// always the outcome of `tasks[i]` regardless of completion order, so
// dedup priority (see SEARCH_GROUPS' comment) is unaffected by concurrency.
async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
const SEARCH_CONCURRENCY = 8;

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

// A 'nightlife' SEARCH_GROUP's includedTypes (bar, pub, brewery, etc.) only
// controls what Google searches FOR — Google still freely returns a place
// whose actual primaryType is 'restaurant' if that place also carries a
// 'bar' secondary type. Every nightlife result is re-checked against this
// list (exact primaryType match required) below, so a bar-and-grill that
// Google classifies as primaryType 'restaurant' gets excluded rather than
// polluting the bars list.
const BAR_PRIMARY_TYPES = [
  'bar', 'night_club', 'pub', 'brewery', 'wine_bar',
  'cocktail_bar', 'sports_bar', 'tavern', 'karaoke',
  'dance_hall', 'jazz_club', 'comedy_club',
];

// 'reviews' is deliberately NOT requested here — Places API (New) only
// populates it on the per-place Get Place (Place Details) endpoint, never
// on searchNearby/searchText, regardless of field mask. See fetchPlaceDetails
// below, which is what actually fills google_reviews/google_photo_refs.
const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.regularOpeningHours', 'places.currentOpeningHours',
  'places.photos', 'places.primaryType', 'places.types',
].join(',');

// Place Details (Get Place) — the only endpoint that actually returns
// `reviews`. Called once per bar AFTER the nightlife rebuild's search+dedup
// pass, so it only spends extra API calls on places that actually made it
// past the chain/primaryType filters (see the isNightlifeRebuild branch in
// the handler below), not on all ~280 search results.
const DETAILS_FIELD_MASK = 'reviews,photos,regularOpeningHours,currentOpeningHours,rating,userRatingCount';

async function fetchPlaceDetails(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Place Details error (${res.status})`);
  return data;
}

// Fetches Place Details for each given venue row (bounded concurrency, same
// limit as the search pass) and writes google_reviews/google_photo_refs/
// hours straight to `venues`. Returns per-place errors rather than throwing,
// so one bad place doesn't take down the whole rebuild's response.
async function enrichWithPlaceDetails(rows) {
  const tasks = rows.map(row => async () => {
    try {
      const details = await fetchPlaceDetails(row.google_place_id);
      const googleReviews = (details.reviews || []).slice(0, 5).map(r => ({
        authorName: r.authorAttribution?.displayName || 'Anonymous',
        authorPhoto: r.authorAttribution?.photoUri || null,
        rating: r.rating,
        text: r.text?.text || '',
        time: r.relativePublishTimeDescription || '',
        publishTime: r.publishTime,
      }));
      const googlePhotoRefs = (details.photos || []).slice(0, 5).map(p => p.name);
      const { error } = await supabaseAdmin
        .from('venues')
        .update({
          google_reviews: googleReviews,
          google_photo_refs: googlePhotoRefs,
          hours: details.currentOpeningHours || details.regularOpeningHours || null,
        })
        .eq('google_place_id', row.google_place_id);
      return error ? `${row.name} (${row.google_place_id}): ${error.message}` : null;
    } catch (e) {
      return `${row.name} (${row.google_place_id}): ${e.message}`;
    }
  });
  const results = await runWithConcurrency(tasks, SEARCH_CONCURRENCY);
  return results.filter(Boolean);
}

// The search GROUP determines the category, full stop — no per-place
// override based on Google's primaryType/types. With single-type searches
// now this granular (a dedicated 'bar' search, a dedicated 'pub' search,
// etc. — see SEARCH_GROUPS), Google's own type-matching does the nightlife
// classification; any hybrid venue that still slips through with the wrong
// category is meant to be caught by the name-pattern SQL cleanup run after
// a sync, not by string-sniffing primaryType here.
async function searchNearby(types, center) {
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
          center: { latitude: center.lat, longitude: center.lng },
          radius: center.radius,
        },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Places API error (${res.status})`);
  return data.places || [];
}

// Search results are scoped to the SEARCH_CENTERS circles around greater
// Chattanooga, but Google's formattedAddress free text can list a
// neighboring town (East Ridge, Red Bank, Hixson…) — hardcoding city/state
// keeps every synced venue matching the map's `.eq('city', 'Chattanooga')`
// query.
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
    // currentOpeningHours (which reflects today's actual hours, holiday
    // closures, etc.) is preferred over the generic weekly regularOpeningHours
    // when Google returns both.
    hours: place.currentOpeningHours || place.regularOpeningHours || null,
    // google_reviews/google_photo_refs are left unset here (falling through
    // to their '[]'::jsonb column defaults) — searchNearby's `place` never
    // carries reviews, and photos is inconsistent at best. For nightlife,
    // enrichWithPlaceDetails fills both in immediately after this row lands
    // in `venues` — see the isNightlifeRebuild branch in the handler.
    is_claimed: false,
    source: 'google_places',
    custom_cover_photo: false,
  };
}

// 280 Google API calls (even bounded to 8-at-a-time) can run well past
// Vercel's default Serverless Function timeout — this raises the ceiling as
// far as it goes without a paid-plan-specific override. On a Hobby plan
// this is effectively a no-op (60s is already that plan's hard cap); on Pro
// it actually unlocks the extra time.
export const config = {
  maxDuration: 60,
};

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

  // ?category=<wadupCat> scopes the sync to just that category's SEARCH_GROUPS
  // (e.g. ?category=nightlife runs only the bar/pub/brewery/etc. searches).
  // For 'nightlife' specifically this also switches the write path below to a
  // full delete-and-rebuild instead of the normal pending-queue flow — see
  // isNightlifeRebuild.
  const categoryFilter = req.query.category || null;
  const activeGroups = categoryFilter
    ? SEARCH_GROUPS.filter(g => g.wadupCat === categoryFilter)
    : SEARCH_GROUPS;
  if (categoryFilter && !activeGroups.length) {
    return res.status(400).json({ error: `Unknown category "${categoryFilter}"` });
  }
  const isNightlifeRebuild = categoryFilter === 'nightlife';

  const byCategory = {};
  const errors = [];
  const byPlaceId = new Map(); // dedupe places matched by more than one type group/center
  let skippedChains = 0;
  let skippedNonBar = 0;

  // Flattened in SEARCH_GROUPS-major order (all 5 centers for group 0, then
  // all 5 for group 1, …) so that even under concurrent execution, results
  // get folded into byPlaceId in the same group-priority order as before —
  // runWithConcurrency guarantees results[i] matches tasks[i] regardless of
  // which one actually finishes first over the network.
  const searchTasks = [];
  for (const group of activeGroups) {
    for (const center of SEARCH_CENTERS) {
      searchTasks.push(async () => {
        try {
          return { group, places: await searchNearby(group.types, center) };
        } catch (e) {
          return { group, places: [], error: `${group.types.join('/')} @ (${center.lat},${center.lng}): ${e.message}` };
        }
      });
    }
  }

  const searchResults = await runWithConcurrency(searchTasks, SEARCH_CONCURRENCY);

  for (const { group, places, error } of searchResults) {
    if (error) { errors.push(error); continue; }
    places.forEach(place => {
      if (!place.id || byPlaceId.has(place.id)) return; // first matching group wins
      if (isChain(place.displayName?.text)) { skippedChains++; return; }
      // Every nightlife result must have Google's OWN primaryType exactly in
      // BAR_PRIMARY_TYPES — a restaurant that merely has a 'bar' secondary
      // type does not qualify (see BAR_PRIMARY_TYPES comment above).
      if (group.wadupCat === 'nightlife' && !BAR_PRIMARY_TYPES.includes(place.primaryType)) { skippedNonBar++; return; }
      byCategory[group.wadupCat] = (byCategory[group.wadupCat] || 0) + 1;
      byPlaceId.set(place.id, mapPlaceToRow(place, group.wadupCat));
    });
  }

  const allRows = [...byPlaceId.values()];
  if (!allRows.length) {
    return res.status(200).json({ success: true, added_to_queue: 0, already_live: 0, skipped: 0, totalFetched: 0, byCategory, skippedChains, skippedNonBar, errors });
  }

  // Nightlife rebuild: wipe every existing google_places-sourced nightlife
  // venue before re-inserting the freshly-filtered set below, rather than
  // going through the usual incremental refresh/pending-queue flow. Manually
  // added venues (source != 'google_places') are untouched.
  //
  // Deleted one row at a time (not a single bulk DELETE) because a venue
  // with real dependent rows — a checkin, review, save, etc. — hits an
  // ON DELETE RESTRICT/NO ACTION foreign key and would abort the whole
  // batch. Any row that fails to delete this way is simply left alone
  // rather than losing that real user data; it falls through to the normal
  // liveByPlaceId match below and gets its Google-sourced fields refreshed
  // in place (same as a regular incremental sync) instead of being replaced.
  let rebuildDeleteFailures = 0;
  if (isNightlifeRebuild) {
    const { data: existingNightlifeRows, error: existingError } = await supabaseAdmin
      .from('venues')
      .select('id')
      .eq('category', 'nightlife')
      .eq('source', 'google_places');
    if (existingError) {
      return res.status(500).json({ error: 'Failed to read existing nightlife venues', detail: existingError.message });
    }
    for (const row of existingNightlifeRows || []) {
      const { error: rowDeleteError } = await supabaseAdmin.from('venues').delete().eq('id', row.id);
      if (rowDeleteError) rebuildDeleteFailures++;
    }
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

  // Nightlife rebuild: every candidate here just had its old row deleted
  // above, so this is a straight re-insert into the live `venues` table —
  // not the pending queue. mapPlaceToRow's output already matches venues'
  // columns exactly (unlike venues_pending, which lacks is_claimed/
  // custom_cover_photo), so no field-stripping is needed.
  if (isNightlifeRebuild) {
    if (pendingCandidates.length) {
      const { error } = await supabaseAdmin.from('venues').insert(pendingCandidates);
      if (error) return res.status(500).json({ error: 'Nightlife rebuild insert failed', detail: error.message });
    }

    // One Place Details call per bar that's actually live now (freshly
    // inserted or just refreshed) — reviews/photos, which searchNearby can
    // never provide (see FIELD_MASK's comment above).
    const enrichmentErrors = await enrichWithPlaceDetails([...pendingCandidates, ...liveUpdateCandidates]);

    return res.status(200).json({
      success: true,
      rebuilt: true,
      inserted: pendingCandidates.length,
      refreshed: liveUpdateCandidates.length,
      keptDueToRealData: rebuildDeleteFailures,
      enriched: pendingCandidates.length + liveUpdateCandidates.length - enrichmentErrors.length,
      enrichmentErrors,
      skipped,
      totalFetched: allRows.length,
      byCategory,
      skippedChains,
      skippedNonBar,
      errors,
    });
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
    skippedNonBar,
    errors,
  });
}
