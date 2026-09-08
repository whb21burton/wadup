// lib/placesSync.js — shared Google Places (New) search/filter/mapping logic
// for the sync pipeline. Used by pages/api/places/sync.js (search + write),
// pages/api/places/sync-preview.js (search only, no write), and
// pages/api/places/sync-save.js (write only, no search) — kept in one place
// so "what counts as a match" can never drift between preview and the real
// sync.

// Every combination of SEARCH_GROUPS × SEARCH_CENTERS is its own Google
// Places API call (56 groups × 5 centers = 280 calls per full sync run).
// That's a deliberate, real cost/time tradeoff for comprehensive coverage —
// each single-type search only gets Google's 20-result cap to itself
// (rather than sharing it across several types bundled into one call), and
// each of the 5 overlapping search circles gives Google's ranking a
// different, smaller candidate pool to pick its "top 20" from, surfacing
// venues that would otherwise get crowded out by one city-wide search.
// Flag this to whoever's paying the Google Cloud bill before running it
// often.
export const SEARCH_CENTERS = [
  { lat: 35.0456, lng: -85.3096, radius: 15000 }, // Downtown Chattanooga
  { lat: 35.0456, lng: -85.3096, radius: 8000 },  // Inner downtown, tighter search
  { lat: 35.0200, lng: -85.2200, radius: 10000 }, // Hamilton Place / East Brainerd
  { lat: 35.0700, lng: -85.3000, radius: 8000 },  // North Shore / Hixson
  { lat: 35.0300, lng: -85.3300, radius: 8000 },  // Lookout Mountain / Southside
];

// Listed nightlife-first, then restaurants, then events/sports/outdoors/
// activities — a place matching more than one group's type (rare, but
// possible for a hybrid venue) is assigned to whichever group appears
// FIRST here, via the byPlaceId dedup in each caller. Not every one of
// these type strings is guaranteed to be a currently-valid Places API
// (New) type; an invalid one just fails that one call (caught, logged to
// `errors`) without affecting any other search.
export const SEARCH_GROUPS = [
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
export async function runWithConcurrency(tasks, limit) {
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
export const SEARCH_CONCURRENCY = 8;

// WadUp is meant to surface local/independent spots, not national chains —
// skip any place whose name matches one of these (case-insensitive substring).
export const CHAIN_BLOCKLIST = [
  // Fast food / casual chains
  'mcdonald', 'taco bell', 'burger king', 'wendy', 'chick-fil-a', 'subway',
  'domino', 'pizza hut', 'papa john', 'kfc', 'popeyes', 'sonic', 'arby',
  'cracker barrel', 'buffalo wild wings', 'applebee', 'chili', 'olive garden',
  'red lobster', 'ihop', 'denny', 'waffle house', 'starbucks', 'dunkin',
  'panera', 'chipotle', 'panda express', 'five guys', 'shake shack',
  'in-n-out', 'whataburger', 'cook out', 'hardee', 'jack in the box',
  'little caesar', 'papa murphy', 'jersey mike', 'jimmy john', 'firehouse',
  'wingstop', 'raising cane', 'zaxby', 'golden corral', 'longhorn',
  'texas roadhouse', 'outback', 'red robin', 'hooters', 'dennys', 'bob evan',
  'brothers bagel',
  // Grocery stores
  'food city', 'kroger', 'publix', 'walmart', 'target', 'aldi', 'lidl',
  'whole foods', 'trader joe', 'costco', 'sams club', "sam's club",
  'food lion', 'giant', 'safeway', 'albertsons', 'meijer', 'heb',
  'ingles', 'bi-lo', 'piggly wiggly', 'winn dixie', 'dollar',
  // Pharmacies
  'cvs', 'walgreen', 'rite aid',
  // Gas stations
  'shell', 'bp gas', 'exxon', 'chevron', 'marathon gas', 'speedway',
  'wawa', 'sheetz', 'quiktrip', 'circle k', 'racetrac',
  // Hotels (that aren't bars)
  'holiday inn', 'marriott', 'hilton', 'hyatt', 'hampton inn',
  'best western', 'comfort inn', 'days inn', 'super 8', 'motel 6',
  'doubletree', 'embassy suites', 'courtyard', 'quality inn', 'ramada',
  // Movie theaters / bookstores / big-box
  'amc ', 'amc classic', 'amc majestic', 'amc northgate', 'amc dine-in',
  'regal cinema', 'cinemark', 'marcus theater', 'landmark cinema',
  'barnes & noble', "dick's sporting", 'academy sports',
  'planet fitness', 'la fitness', 'anytime fitness', "gold's gym",
  'great clips', 'sport clips', 'supercuts', 'chuck e cheese',
  // Other non-venue business types that have slipped through
  'silberman group', 'insurance', 'health insurance',
  'nail salon', 'nail spa', 'beauty salon', 'hair salon',
  'sweet and savory classroom', 'cooking class',
  'church', 'ministry', 'cathedral', 'chapel',
];

export function isChain(name) {
  const lower = (name || '').toLowerCase();
  return CHAIN_BLOCKLIST.some(chain => lower.includes(chain));
}

// A 'nightlife' SEARCH_GROUP's includedTypes (bar, pub, brewery, etc.) only
// controls what Google searches FOR — Google still freely returns a place
// whose actual primaryType is 'restaurant' if that place also carries a
// 'bar' secondary type. Every nightlife result is re-checked against this
// list (exact primaryType match required), so a bar-and-grill that Google
// classifies as primaryType 'restaurant' gets excluded rather than polluting
// the bars list.
export const BAR_PRIMARY_TYPES = [
  'bar', 'night_club', 'pub', 'brewery', 'wine_bar',
  'cocktail_bar', 'sports_bar', 'tavern', 'karaoke',
  'dance_hall', 'jazz_club', 'comedy_club',
];

// Applies to EVERY category, not just nightlife — Google's includedTypes
// search is a hint, not a hard filter, so a grocery store, pharmacy, or
// church can still turn up in a restaurant/events/activities search if it
// shares a secondary type with what was searched for. Any place whose
// primaryType is in this list is dropped regardless of which SEARCH_GROUP
// found it. 'lodging'/'motel'/'hotel' are blocked for now too — this app
// has no lodging category yet, so a hotel is just noise until one exists.
export const BLOCKED_PRIMARY_TYPES = [
  'grocery_store', 'supermarket', 'convenience_store', 'gas_station',
  'pharmacy', 'drugstore', 'hardware_store', 'home_goods_store',
  'furniture_store', 'clothing_store', 'shoe_store', 'jewelry_store',
  'book_store', 'electronics_store', 'pet_store', 'florist',
  'insurance_agency', 'real_estate_agency', 'lawyer', 'accounting',
  'hair_care', 'beauty_salon', 'nail_salon', 'spa',
  'church', 'place_of_worship', 'mosque', 'synagogue', 'temple',
  'school', 'university', 'library', 'post_office', 'bank',
  'atm', 'hospital', 'doctor', 'dentist', 'veterinary_care',
  'car_dealer', 'car_repair', 'car_wash', 'parking',
  'laundry', 'storage', 'moving_company',
  'lodging', 'motel', 'hotel',
];

export function isBlockedPrimaryType(primaryType) {
  return !!primaryType && BLOCKED_PRIMARY_TYPES.includes(primaryType);
}

// 'reviews' is deliberately NOT requested here — Places API (New) only
// populates it on the per-place Get Place (Place Details) endpoint, never
// on searchNearby/searchText, regardless of field mask. See
// fetchPlaceDetails below, which is what actually fills google_reviews/
// google_photo_refs.
export const FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.rating', 'places.userRatingCount', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.regularOpeningHours', 'places.currentOpeningHours',
  'places.photos', 'places.primaryType', 'places.types',
].join(',');

// The search GROUP determines the category, full stop — no per-place
// override based on Google's primaryType/types. With single-type searches
// this granular (a dedicated 'bar' search, a dedicated 'pub' search, etc. —
// see SEARCH_GROUPS), Google's own type-matching does most of the
// classification work; isChain/isBlockedPrimaryType/BAR_PRIMARY_TYPES catch
// what slips through.
export async function searchNearby(types, center) {
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
export function mapPlaceToRow(place, wadupCat) {
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
    category: wadupCat, // legacy single-value fallback — only used on insert; never re-applied to existing venues
    // Google's specific type (e.g. "italian_restaurant") as a free-text
    // subcategory — more specific than the broad wadupCat bucket, and
    // already fetched via the field mask, so no extra API cost.
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
    // carries reviews, and photos is inconsistent at best. See
    // fetchPlaceDetails/enrichWithPlaceDetails below for the real source.
    is_claimed: false,
    source: 'google_places',
    custom_cover_photo: false,
  };
}

// Place Details (Get Place) — the only endpoint that actually returns
// `reviews`. Meant to be called once per venue AFTER the search+dedup pass,
// so it only spends extra API calls on places that actually made it past
// the chain/type filters, not on every raw search result.
export const DETAILS_FIELD_MASK = 'reviews,photos,regularOpeningHours,currentOpeningHours,rating,userRatingCount';

export async function fetchPlaceDetails(placeId) {
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

// Fetches Place Details for each given venue row (bounded concurrency) and
// writes google_reviews/google_photo_refs/hours straight to `venues`.
// Returns per-place error strings rather than throwing, so one bad place
// doesn't take down the whole caller.
export async function enrichWithPlaceDetails(rows, supabaseAdmin) {
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

// Runs every SEARCH_GROUPS × SEARCH_CENTERS combination for the given
// groups, applies isChain/isBlockedPrimaryType/BAR_PRIMARY_TYPES, and
// returns the deduped, filtered result rows plus counters — shared by
// sync.js (which then writes them) and sync-preview.js (which just returns
// them for admin review).
export async function runSearch(activeGroups) {
  const byCategory = {};
  const errors = [];
  const byPlaceId = new Map(); // dedupe places matched by more than one type group/center
  let skippedChains = 0;
  let skippedNonBar = 0;
  let skippedBlockedType = 0;

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
      if (isBlockedPrimaryType(place.primaryType)) { skippedBlockedType++; return; }
      // Every nightlife result must have Google's OWN primaryType exactly in
      // BAR_PRIMARY_TYPES — a restaurant that merely has a 'bar' secondary
      // type does not qualify (see BAR_PRIMARY_TYPES comment above).
      if (group.wadupCat === 'nightlife' && !BAR_PRIMARY_TYPES.includes(place.primaryType)) { skippedNonBar++; return; }
      byCategory[group.wadupCat] = (byCategory[group.wadupCat] || 0) + 1;
      byPlaceId.set(place.id, mapPlaceToRow(place, group.wadupCat));
    });
  }

  return { rows: [...byPlaceId.values()], byCategory, errors, skippedChains, skippedNonBar, skippedBlockedType };
}

// Same search pass as runSearch, but for admin review: nothing is excluded,
// every result is annotated with isChain/isBlockedType so the Sync Manager
// preview can show (and let an admin override) auto-rejected candidates
// instead of silently dropping them.
export async function runSearchForPreview(activeGroups) {
  const errors = [];
  const byPlaceId = new Map();

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
      const primaryType = place.primaryType || null;
      const nonBar = group.wadupCat === 'nightlife' && !BAR_PRIMARY_TYPES.includes(primaryType);
      byPlaceId.set(place.id, {
        ...mapPlaceToRow(place, group.wadupCat),
        primaryType,
        isChain: isChain(place.displayName?.text),
        isBlockedType: isBlockedPrimaryType(primaryType) || nonBar,
      });
    });
  }

  return { rows: [...byPlaceId.values()], errors };
}
