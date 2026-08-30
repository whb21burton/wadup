// lib/badges.js — badge definitions + computation.
import { supabase } from './supabase';

// The app went live on this date; "Joined in the first month" is measured
// from here rather than from an arbitrary reference point.
const WADUP_LAUNCH_DATE = new Date('2026-08-27T00:00:00Z');

export const BADGES = [
  { id: 'top_reviewer',     label: '🏆 Top Reviewer',     desc: 'Write 10+ reviews',                condition: (stats) => stats.reviews >= 10 },
  { id: 'bar_hopper',       label: '🍻 Bar Hopper',        desc: 'Check in to 10+ bars',              condition: (stats) => stats.bar_checkins >= 10 },
  { id: 'live_music_fan',   label: '🎵 Live Music Fan',    desc: 'Attend 5+ live music events',       condition: (stats) => stats.music_checkins >= 5 },
  { id: 'trendsetter',      label: '🔥 Trendsetter',       desc: 'Be first to check in 3+ places',    condition: (stats) => stats.first_checkins >= 3 },
  { id: 'foodie',           label: '🍔 Foodie',            desc: 'Review 5+ restaurants',             condition: (stats) => stats.restaurant_reviews >= 5 },
  { id: 'local_legend',     label: '📍 Local Legend',      desc: '50+ check-ins in your city',        condition: (stats) => stats.local_checkins >= 50 },
  { id: 'photo_pro',        label: '📸 Photo Pro',         desc: 'Upload 20+ photos',                 condition: (stats) => stats.photos >= 20 },
  { id: 'social_butterfly', label: '🦋 Social Butterfly',  desc: 'Share 10+ venues',                  condition: (stats) => stats.shares >= 10 },
  { id: 'ticket_master',    label: '🎟️ Ticket Master',    desc: 'Buy tickets to 5+ events',          condition: (stats) => stats.tickets >= 5 },
  { id: 'wadup_og',         label: '⭐ WadUp OG',          desc: 'Joined in the first month',         condition: (stats) => stats.isOG },
];

// Restaurant isn't a real `venues.category` value (the live schema's
// categories are nightlife/outdoors/activities) — approximate "restaurant"
// from subcategory text since there's no dedicated flag to check against.
const RESTAURANT_SUBCATEGORY = /restaurant|dining|food/i;

// Reads only publicly-selectable tables/views: `reviews`, `venue_photos`,
// and `profiles` all have public SELECT policies, and `user_checkin_stats`
// is a pre-aggregated public view (see the phase3_badges_and_leaderboard_views
// migration) — checkins themselves restrict SELECT to the acting user's own
// rows, so this reads the aggregate instead of raw rows. That makes this
// accurate for ANY user id via the plain anon client, not just the caller's
// own — safe to call from client-side pages (e.g. a public profile page).
//
// `shares` and `tickets` have no tracking anywhere in the app yet (sharing a
// venue is a client-only navigator.share() call, and ticket purchases happen
// off-site via the Ticketmaster affiliate link) — those stats are always 0
// until that instrumentation exists, so social_butterfly/ticket_master can't
// be earned yet.
async function computeUserStats(userId) {
  const [
    { data: profile },
    { count: reviewCount },
    { data: restaurantReviews },
    { count: photoCount },
    { data: checkinStats },
  ] = await Promise.all([
    supabase.from('profiles').select('created_at').eq('id', userId).single(),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('reviews').select('id, venues!inner(subcategory)').eq('user_id', userId),
    supabase.from('venue_photos').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('user_checkin_stats').select('*').eq('user_id', userId).maybeSingle(),
  ]);

  const restaurantReviewCount = (restaurantReviews || [])
    .filter(r => RESTAURANT_SUBCATEGORY.test(r.venues?.subcategory || '')).length;

  return {
    reviews: reviewCount || 0,
    restaurant_reviews: restaurantReviewCount,
    photos: photoCount || 0,
    bar_checkins: checkinStats?.bar_checkins || 0,
    music_checkins: checkinStats?.music_checkins || 0,
    first_checkins: checkinStats?.first_checkins || 0,
    local_checkins: checkinStats?.local_checkins || 0,
    shares: 0,
    tickets: 0,
    isOG: !!profile?.created_at && new Date(profile.created_at) <= new Date(WADUP_LAUNCH_DATE.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
}

export async function getUserBadges(userId) {
  if (!userId) return [];
  const stats = await computeUserStats(userId);
  return BADGES.filter(b => b.condition(stats));
}

// Server-only — writes `user_badges`, which has no client INSERT policy
// (badges are earned by meeting a condition, not self-declared). `admin`
// must be the service-role client from pages/api/supabase-admin.js; stats
// are still read through getUserBadges/the public views above, since those
// already work for any user id without needing elevated privilege.
export async function checkAndAwardBadges(admin, userId) {
  if (!admin || !userId) return [];

  const [earnedBadges, { data: existing }] = await Promise.all([
    getUserBadges(userId),
    admin.from('user_badges').select('badge_id').eq('user_id', userId),
  ]);

  const alreadyAwarded = new Set((existing || []).map(row => row.badge_id));
  const newlyEarned = earnedBadges.filter(b => !alreadyAwarded.has(b.id));

  if (newlyEarned.length) {
    await admin.from('user_badges').insert(
      newlyEarned.map(b => ({ user_id: userId, badge_id: b.id }))
    );
  }

  return newlyEarned;
}
