// pages/api/venues/flame.js — vote on how busy/lit a bar is right now.
// Anyone can vote (signed in or anonymous — anonymous votes are deduped by
// IP); one vote per user/IP per venue per day, weighted by who's voting.
import crypto from 'crypto';
import { supabaseAdmin } from '../supabase-admin';
import { getAdminRole, isSuperAdmin } from '../../../lib/admin';

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// admin_roles only has 'super_admin' and 'ambassador' (no generic 'admin'
// role) — the spec's super_admin=1000/admin=100/local=10/anon=1 tiers map
// super_admin -> 1000, ambassador -> 100, is_local profile -> 10, else 1.
async function getVoterWeight(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { weight: 1, userId: null };

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { weight: 1, userId: null };

  const adminRole = await getAdminRole(supabaseAdmin, user.id);
  if (adminRole) return { weight: isSuperAdmin(adminRole) ? 1000 : 100, userId: user.id };

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_local')
    .eq('id', user.id)
    .maybeSingle();

  return { weight: profile?.is_local ? 10 : 1, userId: user.id };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { venue_id, flame_level } = req.body || {};
  if (!venue_id || ![1, 2, 3].includes(flame_level)) {
    return res.status(400).json({ error: 'Missing venue_id or invalid flame_level (must be 1, 2, or 3)' });
  }

  const { weight, userId } = await getVoterWeight(req);
  const ipHash = userId ? null : crypto.createHash('sha256').update(getClientIp(req)).digest('hex');
  const today = new Date().toISOString().slice(0, 10);

  // One vote per user (or per anonymous IP) per venue per day — find any
  // existing vote from today and update it in place rather than piling up
  // duplicate rows.
  let existingQuery = supabaseAdmin
    .from('venue_flames')
    .select('id')
    .eq('venue_id', venue_id)
    .eq('vote_date', today);
  existingQuery = userId ? existingQuery.eq('user_id', userId) : existingQuery.eq('ip_hash', ipHash);
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) return res.status(500).json({ error: 'Vote failed', detail: existingError.message });

  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from('venue_flames')
      .update({ flame_level, weight })
      .eq('id', existing.id);
    if (updateError) return res.status(500).json({ error: 'Vote failed', detail: updateError.message });
  } else {
    const { error: insertError } = await supabaseAdmin
      .from('venue_flames')
      .insert({ venue_id, flame_level, user_id: userId, ip_hash: ipHash, weight, vote_date: today });
    if (insertError) return res.status(500).json({ error: 'Vote failed', detail: insertError.message });
  }

  const { data: todaysVotes, error: votesError } = await supabaseAdmin
    .from('venue_flames')
    .select('flame_level, weight')
    .eq('venue_id', venue_id)
    .eq('vote_date', today);
  if (votesError) return res.status(500).json({ error: 'Failed to tally votes', detail: votesError.message });

  const weightedSum = todaysVotes.reduce((sum, v) => sum + v.flame_level * v.weight, 0);
  const totalWeight = todaysVotes.reduce((sum, v) => sum + v.weight, 0);
  const currentFlame = totalWeight > 0 ? Math.min(3, Math.max(1, Math.round(weightedSum / totalWeight))) : 0;

  const voteCounts = { 1: 0, 2: 0, 3: 0 };
  todaysVotes.forEach(v => { voteCounts[v.flame_level] = (voteCounts[v.flame_level] || 0) + 1; });

  const { error: updateVenueError } = await supabaseAdmin
    .from('venues')
    .update({ current_flame: currentFlame })
    .eq('id', venue_id);
  if (updateVenueError) return res.status(500).json({ error: 'Failed to update venue', detail: updateVenueError.message });

  return res.status(200).json({ current_flame: currentFlame, vote_counts: voteCounts });
}
