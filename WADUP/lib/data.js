// lib/data.js — venue data, category chips, and Ticketmaster helpers

// ── Category chips shown on the map screen ──
export const CATEGORY_CHIPS = [
  { id: 'all',        label: 'All' },
  { id: 'events',     label: '🎵 Events' },
  { id: 'nightlife',  label: '🍸 Bars & Nightlife' },
  { id: 'restaurant', label: '🍔 Restaurants' },
  { id: 'sports',     label: '🏟️ Sports' },
  { id: 'outdoors',   label: '🌳 Outdoors' },
  { id: 'activities', label: '🎳 Activities' },
];

export const CATEGORY_LABELS = Object.fromEntries(CATEGORY_CHIPS.map(c => [c.id, c.label]));

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

export function isVenueNew(v) {
  if (!v.created_at) return false;
  const days = (Date.now() - new Date(v.created_at).getTime()) / 864e5;
  return days >= 0 && days <= 7;
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
  if (isVenueNew(v))          badges.push({ id: 'new',        icon: '🆕', label: 'New' });
  if (isTrending)             badges.push({ id: 'trending',   icon: '🔥', label: 'Trending' });
  if (isBestRated)            badges.push({ id: 'best_rated', icon: '⭐', label: 'Best Rated' });
  return badges;
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

export const TM_REGIONS = [
  {lat:35.0456, lng:-85.3096}, {lat:40.7128, lng:-74.0060},
  {lat:34.0522, lng:-118.2437},{lat:41.8781, lng:-87.6298},
  {lat:29.7604, lng:-95.3698}, {lat:33.4484, lng:-112.0740},
  {lat:47.6062, lng:-122.3321},{lat:39.9526, lng:-75.1652},
  {lat:25.7617, lng:-80.1918}, {lat:44.9778, lng:-93.2650},
  {lat:39.7392, lng:-104.9903},{lat:29.4241, lng:-98.4936},
];
