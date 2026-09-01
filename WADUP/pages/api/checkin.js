import { supabaseAdmin } from './supabase-admin';

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

  const { error: insertError } = await supabaseAdmin
    .from('checkins')
    .insert({ user_id: user.id, venue_id: venueId });
  if (insertError) return res.status(500).json({ error: 'Check-in failed' });

  // Trending score itself isn't a stored column — lib/rankings.js's
  // getTrendingVenues computes it live from recent checkins/reviews/saves/
  // views, so this new checkin row is already picked up by the next read.
  return res.status(200).json({ success: true });
}
