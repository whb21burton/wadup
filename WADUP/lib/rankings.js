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
  if (category) query = query.eq('category', category);

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

  const { data: categories, error } = await supabase
    .from('venues')
    .select('category')
    .eq('city', city)
    .eq('is_hidden', false)
    .gte('total_ratings', 3);
  if (error || !categories?.length) return [];

  const distinctCats = [...new Set(categories.map(c => c.category).filter(Boolean))];
  if (!distinctCats.length) return [];

  const perCategory = Math.max(1, Math.ceil(limit / distinctCats.length));
  const results = await Promise.all(
    distinctCats.map(cat =>
      supabase
        .from('venues')
        .select(VENUE_CARD_FIELDS)
        .eq('city', city)
        .eq('is_hidden', false)
        .eq('category', cat)
        .gte('total_ratings', 3)
        .order('average_rating', { ascending: false })
        .limit(perCategory)
    )
  );

  const combined = results.flatMap(r => r.data || []);
  return combined
    .sort((a, b) => b.average_rating - a.average_rating)
    .slice(0, limit);
}

// ── Phase 3: WadUp Points ──────────────────────────────────────────────
export const POINTS = {
  WRITE_REVIEW: 50,
  REVIEW_GETS_HELPFUL: 10,
  CHECK_IN: 20,
  FIRST_CHECKIN_VENUE: 50, // bonus for being first to check in somewhere
  UPLOAD_PHOTO: 15,
  BUY_TICKET: 100,
  REFER_FRIEND: 200,
  DAILY_LOGIN: 5,
  LOCAL_REVIEW: 25, // bonus points for reviewing in your local city
  VOTE: 5,
};

// ── Phase 7: Voting / vote-based ranking / schedule-based trending ─────
//
// A vote's weight scales with how much the voter's word should count:
// admins/ambassadors curating their city count for a lot, verified locals
// count for more than a drive-by tourist, everyone else counts for 1.
export function getVoteWeight(userProfile, adminRole) {
  if (adminRole?.role === 'super_admin' || adminRole?.role === 'ambassador') return 100;
  if (userProfile?.is_local) return 10;
  return 1;
}

// Ranked by admin_rank_override[category] first (manually curated order),
// then by vote_score — the organic community ranking — for everything else.
// Unlike the other functions in this file, this (and getScheduleTrendingVenues
// below) take `supabase` as a parameter rather than using the module-level
// import, so the same function works from either a client session or an
// admin route without duplicating the query logic.
export async function getRankedVenues(supabase, category, city, limit = 50) {
  let query = supabase
    .from('venues')
    .select(`${VENUE_CARD_FIELDS}, vote_score, admin_rank_override, venue_votes(count)`)
    .eq('city', city)
    .eq('is_hidden', false)
    .order('vote_score', { ascending: false });
  if (category && category !== 'all') query = query.eq('category', category);

  const { data, error } = await query;
  if (error || !data) return [];
  return applyAdminRankOverride(data, category).slice(0, limit);
}

function applyAdminRankOverride(venues, category) {
  const overridden = venues
    .filter(v => v.admin_rank_override?.[category] != null)
    .sort((a, b) => a.admin_rank_override[category] - b.admin_rank_override[category]);
  const rest = venues
    .filter(v => v.admin_rank_override?.[category] == null)
    .sort((a, b) => (b.vote_score || 0) - (a.vote_score || 0));
  return [...overridden, ...rest];
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
    .filter(s => s.venues && !s.venues.is_hidden && (!city || s.venues.city === city) && (category === 'all' || s.venues.category === category))
    .map(s => ({ ...s.venues, _scheduleEntry: s }));
}

// Server-only. `admin` must be the service-role client from
// pages/api/supabase-admin.js — points_log has no INSERT policy for
// anon/authenticated at all, and profiles.wadup_points is protected by a DB
// trigger that silently reverts the write unless auth.role() = 'service_role'.
// Never import/call this from client-side code (that's exactly why it takes
// the admin client as a parameter instead of constructing one itself here —
// this module is also imported by client pages for the read-only ranking
// functions above, and a module-scope service-role client would either
// break those bundles or risk the key ending up somewhere it shouldn't).
export async function awardPoints(admin, userId, points, reason) {
  if (!admin || !userId || !points) return null;

  const { error: logError } = await admin.from('points_log').insert({ user_id: userId, points, reason });
  if (logError) throw logError;

  const { data: profile, error: fetchError } = await admin
    .from('profiles').select('wadup_points').eq('id', userId).single();
  if (fetchError) throw fetchError;

  const newTotal = (profile?.wadup_points || 0) + points;
  const { error: updateError } = await admin.from('profiles').update({ wadup_points: newTotal }).eq('id', userId);
  if (updateError) throw updateError;

  return newTotal;
}
