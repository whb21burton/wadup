// lib/data.js — venue data, category chips, and Ticketmaster helpers

export const DEFAULT_VENUES = [
  {
    id: 'v1', name: 'Tootsies Orchid Lounge', cat: 'nightlife', subcategory: 'Live Music Bar',
    address: '422 Broadway, Nashville, TN 37203', city: 'Nashville', state: 'TN',
    phone: '(615) 726-0463', website: 'tootsies.net',
    lat: 36.1591, lng: -86.7816, live: true,
    average_rating: 4.6, total_ratings: 312,
    is_local_favorite: true, is_restaurant: false,
    has_live_music_today: true, has_trivia_today: false, has_specials_today: false, has_happy_hour_today: true,
    created_at: '2024-01-15',
  },
  {
    id: 'v2', name: 'Honest Pint', cat: 'nightlife', subcategory: 'Craft Beer Bar',
    address: '102 Tremont St, Chattanooga, TN 37405', city: 'Chattanooga', state: 'TN',
    phone: '(423) 648-7446', website: 'honestpint.com',
    lat: 35.0456, lng: -85.3096, live: true,
    average_rating: 4.3, total_ratings: 128,
    is_local_favorite: false, is_restaurant: false,
    has_live_music_today: false, has_trivia_today: true, has_specials_today: false, has_happy_hour_today: false,
    created_at: '2026-08-24',
  },
  {
    id: 'v3', name: 'Top Golf Chattanooga', cat: 'activities', subcategory: 'Golf Entertainment',
    address: '2020 Gunbarrel Rd, Chattanooga, TN 37421', city: 'Chattanooga', state: 'TN',
    phone: '(423) 531-0000', website: 'topgolf.com',
    lat: 35.0527, lng: -85.2480, live: true,
    average_rating: 4.5, total_ratings: 540,
    is_local_favorite: false, is_restaurant: false,
    has_live_music_today: false, has_trivia_today: false, has_specials_today: true, has_happy_hour_today: false,
    created_at: '2023-06-01',
  },
  {
    id: 'v4', name: 'Punchline Comedy Club', cat: 'nightlife', subcategory: 'Comedy Club',
    address: '280 Elizabeth St NE, Atlanta, GA 30307', city: 'Atlanta', state: 'GA',
    phone: '(404) 555-0101', website: 'punchlinecomedy.com',
    lat: 33.7490, lng: -84.3880, live: true,
    average_rating: 4.1, total_ratings: 96,
    is_local_favorite: false, is_restaurant: false,
    has_live_music_today: false, has_trivia_today: false, has_specials_today: false, has_happy_hour_today: false,
    created_at: '2022-11-20',
  },
  {
    id: 'v5', name: 'Bluegrass Grill', cat: 'activities', subcategory: 'Restaurant',
    address: '55 Patten Pkwy, Chattanooga, TN 37402', city: 'Chattanooga', state: 'TN',
    phone: '(423) 555-0199', website: 'bluegrassgrill.example',
    lat: 35.0490, lng: -85.3080, live: true,
    average_rating: 4.7, total_ratings: 210,
    is_local_favorite: true, is_restaurant: true,
    has_live_music_today: false, has_trivia_today: false, has_specials_today: false, has_happy_hour_today: false,
    created_at: '2021-04-02',
  },
  {
    id: 'v6', name: 'Generic Diner', cat: 'activities', subcategory: 'Restaurant',
    address: '10 Main St, Chattanooga, TN 37402', city: 'Chattanooga', state: 'TN',
    phone: '(423) 555-0100', website: '',
    lat: 35.0420, lng: -85.3120, live: true,
    average_rating: 3.4, total_ratings: 12,
    is_local_favorite: false, is_restaurant: true,
    has_live_music_today: false, has_trivia_today: false, has_specials_today: false, has_happy_hour_today: false,
    created_at: '2020-02-02',
  },
];

// ── Category chips shown on the map screen ──
export const CATEGORY_CHIPS = [
  { id: 'all',        label: 'All' },
  { id: 'events',     label: '🎵 Events' },
  { id: 'nightlife',  label: '🍸 Bars & Nightlife' },
  { id: 'sports',     label: '🏟️ Sports' },
  { id: 'outdoors',   label: '🌳 Outdoors' },
  { id: 'activities', label: '🎳 Activities' },
];

// Business categories offered on venue-owner signup — mirrors the map's
// database-backed chips. Events/Sports are Ticketmaster-only on the map, so
// they aren't real self-serve business categories.
export const VENUE_CATEGORIES = [
  { id: 'nightlife',  label: 'Bars & Nightlife' },
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

// Status badges for a venue, highest-priority first. `isTrending` is computed
// externally (top 10 by rating among currently loaded venues) since it depends
// on the whole set, not just this one venue.
export function getVenueBadges(v, isTrending) {
  const badges = [];
  if (v.has_live_music_today) badges.push({ id: 'live',       icon: '🔴', label: 'Live Now' });
  if (v.has_happy_hour_today) badges.push({ id: 'happy_hour', icon: '⏰', label: 'Happy Hour' });
  if (v.has_specials_today)   badges.push({ id: 'specials',   icon: '🏷️', label: 'Specials' });
  if (isVenueNew(v))          badges.push({ id: 'new',        icon: '🆕', label: 'New' });
  if (isTrending)             badges.push({ id: 'trending',   icon: '🔥', label: 'Trending' });
  return badges;
}

// ── Ticketmaster segment → chip mapping ──
// Music/Arts/Comedy/Family all land on the Events chip; Sports gets its own.
export function tmSegmentToCat(seg) {
  if (!seg) return 'events';
  return seg.toLowerCase().includes('sport') ? 'sports' : 'events';
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
