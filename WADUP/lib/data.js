// lib/data.js — venue data, category chips, and Ticketmaster helpers

// ── Category chips shown on the map screen ── Events is the default/first
// chip (no more "All"). The Bars & Nightlife chip's id is 'bars', which does
// NOT match the 'nightlife' value venues are actually stored under — see
// venueMatchesChip's alias below and CATEGORY_LABELS' comment for why this
// list is kept separate from the real category-value space.
//
// `subcategories` backs the desktop sidebar's dropdown (pages/index.js's
// renderDesktopCategoryList) — a category only gets a ▼ arrow once its list
// is non-empty. Each entry's `id` must be typed EXACTLY as it's stored on
// venues.subcategory (Google's primaryType with underscores turned into
// spaces, e.g. 'night club', 'italian restaurant' — see
// lib/placesSync.js's mapPlaceToRow), since venueMatchesChip compares it
// with a plain ===.
export const CATEGORY_CHIPS = [
  { id: 'events', label: '🎵 Events', subcategories: [
    { id: 'Concert Hall', label: 'Concert Hall' },
    { id: 'Theater', label: 'Theater' },
    { id: 'Comedy Club', label: 'Comedy Club' },
    { id: 'Music Venue', label: 'Music Venue' },
  ]},
  { id: 'bars', label: '🍸 Bars & Nightlife', subcategories: [
    { id: 'Sports Bar', label: 'Sports Bar' },
    { id: 'Speakeasy', label: 'Speakeasy' },
    { id: 'Dance Club', label: 'Dance Club' },
    { id: 'Brewery', label: 'Brewery' },
    { id: 'Wine Bar', label: 'Wine Bar' },
    { id: 'Cocktail Bar', label: 'Cocktail Bar' },
    { id: 'Dive Bar', label: 'Dive Bar' },
    { id: 'Karaoke Bar', label: 'Karaoke Bar' },
    { id: 'Live Music Bar', label: 'Live Music Bar' },
    { id: 'Rooftop Bar', label: 'Rooftop Bar' },
  ]},
  { id: 'restaurant', label: '🍔 Restaurants', subcategories: [
    { id: 'American', label: 'American' },
    { id: 'Italian', label: 'Italian' },
    { id: 'Mexican', label: 'Mexican' },
    { id: 'Asian', label: 'Asian' },
    { id: 'BBQ', label: 'BBQ' },
    { id: 'Seafood', label: 'Seafood' },
    { id: 'Steakhouse', label: 'Steakhouse' },
    { id: 'Burgers', label: 'Burgers' },
    { id: 'Pizza', label: 'Pizza' },
    { id: 'Fine Dining', label: 'Fine Dining' },
    { id: 'Brunch', label: 'Brunch' },
    { id: 'Soul Food', label: 'Soul Food' },
    { id: 'Southern', label: 'Southern' },
  ]},
  { id: 'sports', label: '🏟️ Sports', subcategories: [
    { id: 'Football', label: '🏈 Football' },
    { id: 'Baseball', label: '⚾ Baseball' },
    { id: 'Basketball', label: '🏀 Basketball' },
    { id: 'Soccer', label: '⚽ Soccer' },
    { id: 'Hockey', label: '🏒 Hockey' },
  ]},
  { id: 'outdoors', label: '🌳 Outdoors', subcategories: [
    { id: 'Park', label: 'Park' },
    { id: 'Hiking Trail', label: 'Hiking Trail' },
    { id: 'Kayaking', label: 'Kayaking' },
    { id: 'Rock Climbing', label: 'Rock Climbing' },
    { id: 'Disc Golf', label: 'Disc Golf' },
    { id: 'Bike Trail', label: 'Bike Trail' },
  ]},
  { id: 'activities', label: '🎳 Activities', subcategories: [
    { id: 'Bowling', label: 'Bowling' },
    { id: 'Top Golf', label: 'Top Golf' },
    { id: 'Escape Room', label: 'Escape Room' },
    { id: 'Axe Throwing', label: 'Axe Throwing' },
    { id: 'Arcade', label: 'Arcade' },
    { id: 'Go Karts', label: 'Go Karts' },
  ]},
];

// Keyed by the real category values stored on a venue (venues.categories /
// .category) or a Ticketmaster event (.cat) — deliberately NOT derived from
// CATEGORY_CHIPS above, since that list's 'bars' chip id doesn't match the
// 'nightlife' value venues are actually stored under. Every other page that
// labels a venue/event by its actual category (venue profile, discover,
// browse, profile tabs, admin sync stats) reads this dict.
export const CATEGORY_LABELS = {
  events: '🎵 Events',
  nightlife: '🍸 Bars & Nightlife',
  restaurant: '🍔 Restaurants',
  sports: '🏟️ Sports',
  outdoors: '🌳 Outdoors',
  activities: '🎳 Activities',
};

// Shared by every admin-facing venue emoji picker (pages/admin/venues.js,
// pages/index.js's on-map admin modals, components/AdminEditPanel.js) —
// centralized here after the third copy would otherwise have been pasted.
export const EMOJI_OPTIONS = [
  // Food & Drink
  '🍔', '🍕', '🌮', '🍣', '🍜', '🥢', '🍱', '🥩', '🍗', '🥗',
  '🍺', '🍸', '🍷', '☕', '🧃', '🥂', '🍾', '🧉',
  // Activities
  '🎳', '⛳', '🏌️', '🧗', '🚣', '🏊', '🎯', '🎮', '🎪', '🎠',
  '🎭', '🎬', '🎵', '🎤', '🎸', '🎺',
  // Sports
  '🏈', '⚾', '🏀', '🏒', '⚽', '🎾', '🏋️', '🤼', '🏇', '🥊',
  // Nature & Outdoors
  '🌳', '🌲', '⛰️', '🏔️', '🌊', '🏕️', '🌿', '🌺',
  // Places & Vibes
  '🍽️', '🕯️', '✨', '👑', '🔥', '⭐', '💎', '🏆',
  '🎉', '🎊', '🌙', '🌅', '🏙️', '🗺️',
  // Specific
  '🎰', '🎲', '🃏',
];

// venues.categories is the array column (Phase 8); venues.category is kept
// as a single-value fallback for any row that predates the backfill or any
// write path that hasn't been updated to send the array yet.
export function venueCategories(v) {
  if (v.categories?.length) return v.categories;
  return v.category ? [v.category] : [];
}

// `subcategory`, when given, narrows a category match down to venues whose
// stored .subcategory is an exact match (see CATEGORY_CHIPS' comment) — used
// by the sidebar dropdown's per-subcategory filtering. Omitted/falsy means
// "match the whole category", same as before.
export function venueMatchesChip(chip, venue, subcategory) {
  if (!chip) return true;
  const cats = venueCategories(venue);
  // The map's chip id is 'bars', but venues are stored under 'nightlife' —
  // match either so the chip actually finds them.
  const chipMatches = chip === 'bars'
    ? (cats.includes('nightlife') || cats.includes('bars'))
    : cats.includes(chip);
  if (!chipMatches) return false;
  if (subcategory) return venue.subcategory === subcategory;
  return true;
}

// National/regional chains are filtered out of the public map entirely —
// WadUp is meant to surface local spots, not the same 30 chains every city
// already has. No `is_chain` column exists on venues, so this is a
// name-substring check applied client-side wherever venues are loaded for
// the map (see pages/index.js's loadVenuesFromSupabase).
const CHAIN_NAMES = [
  'mcdonald', 'taco bell', 'burger king', 'subway', 'starbucks',
  'chick-fil-a', 'wendy', 'domino', 'pizza hut', 'kfc', 'popeyes', 'sonic',
  'cracker barrel', 'buffalo wild wings', 'applebee', 'olive garden', 'red lobster',
  'ihop', 'waffle house', 'dunkin', 'panera', 'chipotle', 'five guys',
  'jersey mike', 'jimmy john', 'wingstop', 'raising cane', 'zaxby',
  'golden corral', 'texas roadhouse', 'outback', 'longhorn', 'walmart',
  'target', 'whole foods', 'publix', 'barnes & noble', 'planet fitness',
];

export function isChain(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return CHAIN_NAMES.some(c => n.includes(c));
}

// Business categories offered on venue-owner signup — mirrors the map's
// database-backed chips. Events/Sports are Ticketmaster-only on the map, so
// they aren't real self-serve business categories.
export const VENUE_CATEGORIES = [
  { id: 'nightlife',  label: 'Bars & Nightlife' },
  { id: 'restaurant', label: 'Restaurant' },
  { id: 'outdoors',   label: 'Outdoors' },
  { id: 'activities', label: 'Activities' },
];

export function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Venue visibility rule: restaurants only surface if something's actually
// happening there today (or they're a certified local favorite); every other
// database category (bars/nightlife, outdoors, activities) always appears. ──
export function isVenueEligible(v) {
  if (v.is_restaurant) {
    return !!(v.is_local_favorite || v.has_live_music_today || v.has_trivia_today || v.has_specials_today);
  }
  return true;
}

// A venue only gets its own WadUp star rating once it has a real sample size
// of WadUp reviews; below that threshold, its Google rating (imported at
// sync time — see pages/api/places/sync.js) is the more meaningful number.
export function hasWadupRating(v) {
  return (v.total_ratings || 0) >= 5;
}
export function effectiveRating(v) {
  return hasWadupRating(v) ? v.average_rating : v.google_rating;
}
export function effectiveRatingCount(v) {
  return hasWadupRating(v) ? v.total_ratings : v.google_review_count;
}

// Parses a Google Places `regularOpeningHours` object (the shape stored in
// venues.hours — { periods: [{ open: {day,hour,minute}, close: {...} }] })
// against the viewer's local clock. Good enough for a single-city app;
// doesn't account for a visitor browsing from a different timezone than
// the venue's, since the New Places API fieldmask used here doesn't return
// a timezone to correct for.
export function isVenueOpenNow(hours) {
  const periods = hours?.periods;
  if (!periods?.length) return false;
  const now = new Date();
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();

  return periods.some(p => {
    if (!p.open) return false;
    const openDay  = p.open.day;
    const openMins = (p.open.hour || 0) * 60 + (p.open.minute || 0);
    if (!p.close) return openDay === day; // open 24 hours that day
    const closeDay  = p.close.day;
    const closeMins = (p.close.hour || 0) * 60 + (p.close.minute || 0);

    if (openDay === closeDay) {
      return day === openDay && mins >= openMins && mins < closeMins;
    }
    // Overnight span, e.g. opens Fri 6pm, closes Sat 2am.
    if (day === openDay)  return mins >= openMins;
    if (day === closeDay) return mins < closeMins;
    return false;
  });
}

// Status badges for a venue, highest-priority first. `isTrending`/`isBestRated`
// are computed externally (top 10 in their city, per lib/rankings.js) since
// they depend on the whole set, not just this one venue; same for
// `hasEventToday`, which depends on that day's venue_events across the map.
export function getVenueBadges(v, isTrending, isBestRated, hasEventToday) {
  const badges = [];
  if (v.has_live_music_today) badges.push({ id: 'live',       icon: '🔴', label: 'Live Now' });
  if (v.has_happy_hour_today) badges.push({ id: 'happy_hour', icon: '⏰', label: 'Happy Hour' });
  if (v.has_specials_today)   badges.push({ id: 'specials',   icon: '🏷️', label: 'Specials' });
  if (hasEventToday)          badges.push({ id: 'event_today',icon: '🎫', label: 'Event Today' });
  if (isVenueOpenNow(v.hours))badges.push({ id: 'open_now',   icon: '🟢', label: 'Open Now' });
  if (isTrending)             badges.push({ id: 'trending',   icon: '🔥', label: 'Trending' });
  if (isBestRated)            badges.push({ id: 'best_rated', icon: '⭐', label: 'Best Rated' });
  return badges;
}

// venue_events.event_type → the small top-left icon an Events-chip pin shows
// for that event, when it isn't currently live (a live event's pin shows the
// animated wu-live-music-note instead — see pages/index.js's dropVenuePin/
// dropBarPin).
const EVENT_TYPE_ICONS = {
  live_music: '🎵',
  farmers_market: '🧑‍🌾',
  trivia: '🧠',
  dj: '🎧',
  comedy: '🎤',
  karaoke: '🎤',
  sports: '🏆',
  festival: '🎪',
  art: '🎨',
  other: '📍',
};
export function getEventIcon(eventType) {
  return EVENT_TYPE_ICONS[eventType] || '📍';
}

const SPORT_KEYWORDS = [
  'volleyball','basketball','football','baseball','soccer','hockey',
  'tennis','golf','wrestling','boxing','mma','ufc','nfl','nba','mlb',
  'nhl','mls','nascar','racing','gymnastics','swimming','track',
  'lacrosse','softball','rugby','cricket','polo','rodeo','marathon',
  'triathlon','cycling','skiing','snowboard','bowl','championship',
  'tournament','league','vs.','versus','game','match','playoff','series'
];

function nameIsSport(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return SPORT_KEYWORDS.some(k => n.includes(k));
}

// ── Ticketmaster classification → chip mapping ──
// Music/Arts/Comedy/Family all land on the Events chip; Sports gets its own.
// Checks every classification level (segment/type/genre/subGenre) because a
// "sport" signal can show up in any of them depending on the event. Some
// listings (e.g. certain Vanderbilt Commodores Women's Volleyball games) come
// back from Ticketmaster with no useful classification data at all — segment
// "Undefined" and no type/genre/subGenre — so as a last resort, fall back to
// scanning the event name itself for sport keywords.
export function tmSegmentToCat(classifications, eventName) {
  if (!classifications || !classifications.length) {
    return nameIsSport(eventName) ? 'sports' : 'events';
  }
  const c = classifications[0];
  const fields = [c.segment?.name, c.type?.name, c.genre?.name, c.subGenre?.name]
    .filter(Boolean).join(' ').toLowerCase();
  if (fields.includes('sport')) return 'sports';
  if (fields === 'undefined' || fields.trim() === '') return nameIsSport(eventName) ? 'sports' : 'events';
  return 'events';
}

const SPORT_EMOJI_RULES = [
  { test: /\bnfl\b|football(?!\s*club)/i, emoji: '🏈' },
  { test: /\bmlb\b|baseball/i,            emoji: '⚾' },
  { test: /\bnba\b|basketball/i,          emoji: '🏀' },
  { test: /\bnhl\b|hockey/i,              emoji: '🏒' },
  { test: /\bmls\b|soccer|football club/i, emoji: '⚽' },
];

// Detects a sport-specific emoji from a Ticketmaster event's segment/genre
// fields, falling back to a generic stadium icon for other sports.
export function tmSportEmoji(ev) {
  const haystack = [ev.genre, ev.subGenre, ev.segment, ev.name].filter(Boolean).join(' ');
  for (const rule of SPORT_EMOJI_RULES) {
    if (rule.test.test(haystack)) return rule.emoji;
  }
  return '🏟️';
}

// Nationwide Ticketmaster search regions — used server-side only, by
// pages/api/cron/sync-tm-events.js (a 2-hourly Vercel Cron job that
// populates the tm_events_cache table; see vercel.json). pages/index.js no
// longer imports this — it reads the already-fetched, already-nationwide
// cache instead of hitting the Ticketmaster API per pageview, which is what
// makes 43 regions affordable at all (43 calls every 2 hours from the cron,
// not 43 calls × every single visitor).
export const TM_REGIONS = [
  {lat:40.7128, lng:-74.0060},  // NYC
  {lat:42.3601, lng:-71.0589},  // Boston
  {lat:39.9526, lng:-75.1652},  // Philadelphia
  {lat:38.9072, lng:-77.0369},  // DC
  {lat:35.0456, lng:-85.3096},  // Chattanooga
  {lat:36.1627, lng:-86.7816},  // Nashville
  {lat:35.2271, lng:-80.8431},  // Charlotte
  {lat:33.7490, lng:-84.3880},  // Atlanta
  {lat:25.7617, lng:-80.1918},  // Miami
  {lat:28.5383, lng:-81.3792},  // Orlando
  {lat:30.3322, lng:-81.6557},  // Jacksonville
  {lat:35.7796, lng:-78.6382},  // Raleigh
  {lat:41.8781, lng:-87.6298},  // Chicago
  {lat:39.7684, lng:-86.1581},  // Indianapolis
  {lat:39.9612, lng:-82.9988},  // Columbus
  {lat:41.4993, lng:-81.6944},  // Cleveland
  {lat:42.3314, lng:-83.0458},  // Detroit
  {lat:44.9778, lng:-93.2650},  // Minneapolis
  {lat:38.6270, lng:-90.1994},  // St Louis
  {lat:39.0997, lng:-94.5786},  // Kansas City
  {lat:29.7604, lng:-95.3698},  // Houston
  {lat:29.4241, lng:-98.4936},  // San Antonio
  {lat:30.2672, lng:-97.7431},  // Austin
  {lat:32.7767, lng:-96.7970},  // Dallas
  {lat:35.4676, lng:-97.5164},  // Oklahoma City
  {lat:32.2988, lng:-90.1848},  // Jackson MS
  {lat:29.9511, lng:-90.0715},  // New Orleans
  {lat:35.1495, lng:-90.0490},  // Memphis
  {lat:39.7392, lng:-104.9903}, // Denver
  {lat:40.7608, lng:-111.8910}, // Salt Lake City
  {lat:33.4484, lng:-112.0740}, // Phoenix
  {lat:36.1699, lng:-115.1398}, // Las Vegas
  {lat:34.0522, lng:-118.2437}, // LA
  {lat:37.7749, lng:-122.4194}, // SF
  {lat:47.6062, lng:-122.3321}, // Seattle
  {lat:45.5051, lng:-122.6750}, // Portland
  {lat:32.7157, lng:-117.1611}, // San Diego
  {lat:32.3668, lng:-86.3000},  // Montgomery AL
  {lat:30.6954, lng:-88.0399},  // Mobile AL
  {lat:36.1540, lng:-95.9928},  // Tulsa
  {lat:30.4515, lng:-91.1871},  // Baton Rouge
  {lat:43.0389, lng:-87.9065},  // Milwaukee (as-given coords were actually Syracuse's — corrected)
  {lat:41.2565, lng:-95.9345},  // Omaha
  {lat:21.3069, lng:-157.8583}, // Honolulu
];

// TM's Discovery API returns localTime as 24-hour "HH:MM" or "HH:MM:SS" —
// this is the one shared 12-hour formatter for it (and for any other
// "HH:MM[:SS]" string, e.g. venue_schedule's open_time/close_time).
export function formatTime(timeStr) {
  if (!timeStr) return '';
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  } catch {
    return timeStr;
  }
}
