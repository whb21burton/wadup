// lib/rankings.js — Phase 2 trending/rating/popularity rankings, scoped by city.
//
// Trending score = weighted sum of recent activity, each event scaled by how
// recent it is:
//   Check-ins last 24h:  +10 points each
//   Check-ins last 7d:   +3 points each
//   Reviews last 7d:     +5 points each
//   Saves last 7d:       +2 points each
//   Views last 24h:      +1 point each
//   Recency multiplier:  last 2h = 3x, last 6h = 2x, last 24h (and beyond) = 1x
//
// checkins/saved_venues restrict SELECT to the acting user's own rows (RLS),
// so this reads the anonymized `*_activity` views instead (venue_id + When
// only — see the phase2_rankings_activity_tracking migration) to see
// everyone's activity without exposing who did what.

import { supabase } from './supabase';

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;
const WEEK = 7 * DAY;

const VENUE_CARD_FIELDS = 'id, name, category, subcategory, city, state, address, lat, lng, average_rating, total_ratings, cover_photo_url, view_count, save_count';

function recencyMultiplier(ageMs) {
  if (ageMs <= 2 * HOUR) return 3;
  if (ageMs <= 6 * HOUR) return 2;
  return 1;
}

// Tallies `points(ageMs) * recencyMultiplier(ageMs)` per venue_id into `scores`.
function addActivityScores(scores, rows, timestampField, pointsForAge) {
  const now = Date.now();
  (rows || []).forEach(row => {
    const venueId = row.venue_id;
    const ts = row[timestampField];
    if (!venueId || !ts) return;
    const ageMs = now - new Date(ts).getTime();
    if (ageMs < 0) return;
    const base = pointsForAge(ageMs);
    if (base <= 0) return;
    scores[venueId] = (scores[venueId] || 0) + base * recencyMultiplier(ageMs);
  });
}

// ── 🔥 Trending — recent-activity score, highest first ──
export async function getTrendingVenues(city, limit = 20) {
  if (!city) return [];

  const { data: venues, error } = await supabase
    .from('venues')
    .select(VENUE_CARD_FIELDS)
    .eq('city', city)
    .eq('is_hidden', false);
  if (error || !venues?.length) return [];

  const ids = venues.map(v => v.id);
  const weekAgoIso = new Date(Date.now() - WEEK).toISOString();
  const dayAgoIso  = new Date(Date.now() - DAY).toISOString();

  const [{ data: checkins }, { data: reviews }, { data: saves }, { data: views }] = await Promise.all([
    supabase.from('checkins_activity').select('venue_id, created_at').in('venue_id', ids).gte('created_at', weekAgoIso),
    supabase.from('reviews').select('venue_id, created_at').in('venue_id', ids).gte('created_at', weekAgoIso),
    supabase.from('saved_venues_activity').select('venue_id, created_at').in('venue_id', ids).gte('created_at', weekAgoIso),
    supabase.from('venue_views_activity').select('venue_id, viewed_at').in('venue_id', ids).gte('viewed_at', dayAgoIso),
  ]);

  const scores = {};
  addActivityScores(scores, checkins, 'created_at', ageMs => (ageMs <= DAY ? 10 : ageMs <= WEEK ? 3 : 0));
  addActivityScores(scores, reviews,  'created_at', ageMs => (ageMs <= WEEK ? 5 : 0));
  addActivityScores(scores, saves,    'created_at', ageMs => (ageMs <= WEEK ? 2 : 0));
  addActivityScores(scores, views,    'viewed_at',  ageMs => (ageMs <= DAY ? 1 : 0));

  return venues
    .map(v => ({ ...v, trending_score: scores[v.id] || 0 }))
    .filter(v => v.trending_score > 0)
    .sort((a, b) => b.trending_score - a.trending_score)
    .slice(0, limit);
}

// ── ⭐ Best Rated — needs a real sample size to mean anything ──
export async function getBestRated(city, limit = 20, category = null) {
  if (!city) return [];

  let query = supabase
    .from('venues')
    .select(VENUE_CARD_FIELDS)
    .eq('city', city)
    .eq('is_hidden', false)
    .gte('total_ratings', 5)
    .order('average_rating', { ascending: false })
    .order('total_ratings', { ascending: false })
    .limit(limit);
  if (category) query = query.overlaps('categories', [category]);

  const { data, error } = await query;
  return error ? [] : (data || []);
}

// ── 🏆 Most Popular — all-time engagement, no recency weighting ──
export async function getMostPopular(city, limit = 20) {
  if (!city) return [];

  const { data: venues, error } = await supabase
    .from('venues')
    .select(VENUE_CARD_FIELDS)
    .eq('city', city)
    .eq('is_hidden', false);
  if (error || !venues?.length) return [];

  const ids = venues.map(v => v.id);
  const [{ data: checkins }, { data: reviews }, { data: saves }] = await Promise.all([
    supabase.from('checkins_activity').select('venue_id').in('venue_id', ids),
    supabase.from('reviews').select('venue_id').in('venue_id', ids),
    supabase.from('saved_venues_activity').select('venue_id').in('venue_id', ids),
  ]);

  const tally = {};
  const addTally = (rows) => (rows || []).forEach(r => { tally[r.venue_id] = (tally[r.venue_id] || 0) + 1; });
  addTally(checkins);
  addTally(reviews);
  addTally(saves);

  return venues
    .map(v => ({ ...v, popularity_score: (tally[v.id] || 0) + (v.view_count || 0) }))
    .sort((a, b) => b.popularity_score - a.popularity_score)
    .slice(0, limit);
}

// ── 🏆 Local Favorites — best-rated venue(s) per category, capped at `limit` ──
export async function getLocalFavorites(city, limit = 10) {
  if (!city) return [];

  const { data: categoryRows, error } = await supabase
    .from('venues')
    .select('categories')
    .eq('city', city)
    .eq('is_hidden', false)
    .gte('total_ratings', 3);
  if (error || !categoryRows?.length) return [];

  const distinctCats = [...new Set(categoryRows.flatMap(r => r.categories || []).filter(Boolean))];
  if (!distinctCats.length) return [];

  const perCategory = Math.max(1, Math.ceil(limit / distinctCats.length));
  const results = await Promise.all(
    distinctCats.map(cat =>
      supabase
        .from('venues')
        .select(VENUE_CARD_FIELDS)
        .eq('city', city)
        .eq('is_hidden', false)
        .overlaps('categories', [cat])
        .gte('total_ratings', 3)
        .order('average_rating', { ascending: false })
        .limit(perCategory)
    )
  );

  // A multi-category venue can win a "best in category" slot for more than
  // one of its categories — dedupe by id before capping to `limit`, or it
  // could occupy multiple of the final spots under the same identity.
  const seen = new Set();
  const combined = results.flatMap(r => r.data || []).filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
  return combined
    .sort((a, b) => b.average_rating - a.average_rating)
    .slice(0, limit);
}

// ── Weighted ratings — replaces the old points/vote system ─────────────
//
// A reviewer's rating counts for more the more their word should count:
// admins/ambassadors curating their city count for a lot, verified locals
// count for more than a drive-by tourist, everyone else counts for 1. Used
// both to weight a single review's contribution to a venue's rating, and
// (via getVoteWeight itself) nowhere else now that voting is gone — kept
// under this name since callers already import it that way and the formula
// is identical either way.
export function getVoteWeight(userProfile, adminRole) {
  if (adminRole?.role === 'super_admin' || adminRole?.role === 'ambassador') return 100;
  if (userProfile?.is_local) return 10;
  return 1;
}

// Recalculates a venue's weighted_rating (+ per-subcategory breakdown) from
// scratch off every review currently on it. Called after any review is
// written — see pages/api/reviews/submit.js. `supabaseAdmin` must be the
// service-role client: reading every reviewer's profile/admin_roles row to
// compute weights isn't something the reviewing user's own session is
// allowed to do via RLS (those tables only expose a user's own row to them).
export async function recalculateVenueRating(supabaseAdmin, venueId) {
  const { data: reviews } = await supabaseAdmin
    .from('reviews')
    .select('overall_rating, subcategory_ratings, user_id')
    .eq('venue_id', venueId);

  if (!reviews || reviews.length === 0) {
    await supabaseAdmin.from('venues').update({
      weighted_rating: 0,
      weighted_rating_count: 0,
      subcategory_weighted_ratings: {},
    }).eq('id', venueId);
    return;
  }

  const userIds = [...new Set(reviews.map(r => r.user_id).filter(Boolean))];
  const [{ data: profiles }, { data: adminRoles }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, is_local').in('id', userIds),
    supabaseAdmin.from('admin_roles').select('user_id, role').in('user_id', userIds),
  ]);
  const profileById = new Map((profiles || []).map(p => [p.id, p]));
  const adminRoleByUserId = new Map((adminRoles || []).map(r => [r.user_id, r]));

  let totalWeight = 0, weightedSum = 0;
  const subcatSums = {}, subcatWeights = {};

  for (const review of reviews) {
    const weight = getVoteWeight(profileById.get(review.user_id), adminRoleByUserId.get(review.user_id));
    totalWeight += weight;
    weightedSum += (review.overall_rating || 0) * weight;

    if (review.subcategory_ratings) {
      Object.entries(review.subcategory_ratings).forEach(([subcat, rating]) => {
        subcatSums[subcat] = (subcatSums[subcat] || 0) + rating * weight;
        subcatWeights[subcat] = (subcatWeights[subcat] || 0) + weight;
      });
    }
  }

  const weightedRating = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;

  const subcatRatings = {};
  Object.keys(subcatSums).forEach(subcat => {
    subcatRatings[subcat] = Math.round((subcatSums[subcat] / subcatWeights[subcat]) * 10) / 10;
  });

  await supabaseAdmin.from('venues').update({
    weighted_rating: weightedRating,
    weighted_rating_count: reviews.length,
    subcategory_weighted_ratings: subcatRatings,
  }).eq('id', venueId);
}

// Ranks an already-fetched, already-scoped (e.g. to the current map viewport)
// list of venues by weighted_rating, purely client-side — no Supabase query
// of its own, unlike every other function in this file. Used for both the
// on-pin area-rank label and the sidebar's Top 10 list (pages/index.js),
// which both need this same viewport-relative ranking, not a city-wide one.
export function rankVenuesInBounds(venues, chip) {
  const filtered = venues.filter(v => {
    if (v.is_hidden) return false;
    if (chip === 'all') return true;
    const cats = v.categories || (v.category ? [v.category] : []);
    return cats.includes(chip);
  });

  return filtered
    .sort((a, b) => (b.weighted_rating || 0) - (a.weighted_rating || 0))
    .map((v, i) => ({ ...v, _areaRank: i + 1 }));
}

// A venue is "trending now" if it has a venue_event_schedule entry starting
// within its event type's window today — distinct from getTrendingVenues
// above (which measures recent checkins/reviews/saves/views) — this measures
// upcoming scheduled events instead. Named separately to avoid colliding
// with that existing export, since the two are genuinely different signals.
const TRENDING_WINDOWS = {
  sports_game: 120, // 2 hours before
  live_music: 120,  // 2 hours before
  event: 120,       // 2 hours before
  trivia: 60,       // 1 hour before
  happy_hour: 30,   // 30 mins before
  specials: 30,     // 30 mins before
  activities: 60,   // 1 hour before
};

function timeToMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Ticketmaster events aren't in this calculation — they're a separate,
// client-fetched data source (pages/index.js's tmEventsRef), not something a
// Supabase query here can see; a caller that wants both merges them itself.
export async function getScheduleTrendingVenues(supabase, category, city) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const nowMins = timeToMins(now.toTimeString().slice(0, 5));

  const { data: schedules, error } = await supabase
    .from('venue_event_schedule')
    .select('*, venues(*)')
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true);
  if (error || !schedules) return [];

  return schedules
    .filter(s => {
      const window = TRENDING_WINDOWS[s.event_type] || 60;
      const startMins = timeToMins(s.start_time);
      return nowMins >= startMins - window && nowMins < startMins + 30;
    })
    .filter(s => s.venues && !s.venues.is_hidden && (!city || s.venues.city === city) && (category === 'all' || (s.venues.categories || []).includes(category)))
    .map(s => ({ ...s.venues, _scheduleEntry: s }));
}

