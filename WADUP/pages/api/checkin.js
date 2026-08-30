import { supabaseAdmin } from './supabase-admin';
import { awardPoints, POINTS } from '../../lib/rankings';
import { checkAndAwardBadges } from '../../lib/badges';

const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours — anti-abuse re-checkin window

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Not signed in' });

  const { venueId } = req.body || {};
  if (!venueId) return res.status(400).json({ error: 'Missing venueId' });

  const cutoffIso = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: recent, error: recentError } = await supabaseAdmin
    .from('checkins')
    .select('id')
    .eq('user_id', user.id)
    .eq('venue_id', venueId)
    .gte('created_at', cutoffIso)
    .limit(1);

  if (recentError) return res.status(500).json({ error: 'Check-in failed' });
  if (recent && recent.length) {
    return res.status(409).json({ error: 'You already checked in here recently' });
  }

  // Must count existing check-ins BEFORE inserting this one, or the new row
  // would count itself and "first ever" would never trigger.
  const { count: priorCount, error: countError } = await supabaseAdmin
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);
  if (countError) return res.status(500).json({ error: 'Check-in failed' });
  const isFirstEver = !priorCount;

  const { error: insertError } = await supabaseAdmin
    .from('checkins')
    .insert({ user_id: user.id, venue_id: venueId });
  if (insertError) return res.status(500).json({ error: 'Check-in failed' });

  let pointsAwarded = POINTS.CHECK_IN;
  await awardPoints(supabaseAdmin, user.id, POINTS.CHECK_IN, 'check_in');

  if (isFirstEver) {
    await awardPoints(supabaseAdmin, user.id, POINTS.FIRST_CHECKIN_VENUE, 'first_checkin_venue');
    pointsAwarded += POINTS.FIRST_CHECKIN_VENUE;
  }

  // Badge conditions (bar_hopper, live_music_fan, trendsetter, local_legend)
  // can change on every check-in — recompute and persist any newly earned.
  const newBadges = await checkAndAwardBadges(supabaseAdmin, user.id).catch(() => []);

  // Trending score itself isn't a stored column — lib/rankings.js's
  // getTrendingVenues computes it live from recent checkins/reviews/saves/
  // views, so this new checkin row is already picked up by the next read.
  return res.status(200).json({
    success: true,
    pointsAwarded,
    firstEver: isFirstEver,
    newBadges: newBadges.map(b => b.id),
  });
}
