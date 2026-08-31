// pages/api/venues/vote.js — POST { venue_id, vote: 1 | -1 }
// `category` is derived from the venue's own row, not trusted from the
// client — venue_votes' unique(user_id, venue_id, category) constraint only
// enforces "one vote per venue" if every vote for a venue is stored under
// the same category value; letting the client pick an arbitrary string
// would let someone vote many times on the same venue.
import { supabaseAdmin } from '../supabase-admin';
import { getAdminRole } from '../../../lib/admin';
import { getVoteWeight, awardPoints, POINTS } from '../../../lib/rankings';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Not signed in' });

  const { venue_id: venueId, vote } = req.body || {};
  if (!venueId || (vote !== 1 && vote !== -1)) {
    return res.status(400).json({ error: 'Missing venue_id or invalid vote (must be 1 or -1)' });
  }

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues').select('id, category').eq('id', venueId).single();
  if (venueError || !venue) return res.status(404).json({ error: 'Venue not found' });

  const { data: checkin } = await supabaseAdmin
    .from('checkins').select('id').eq('user_id', user.id).eq('venue_id', venueId).limit(1);
  if (!checkin?.length) {
    return res.status(403).json({ error: 'Check in first to vote' });
  }

  const [{ data: profile }, adminRole, { data: existingVote }] = await Promise.all([
    supabaseAdmin.from('profiles').select('is_local').eq('id', user.id).single(),
    getAdminRole(supabaseAdmin, user.id),
    supabaseAdmin.from('venue_votes').select('id')
      .eq('user_id', user.id).eq('venue_id', venueId).eq('category', venue.category).maybeSingle(),
  ]);

  const weight = getVoteWeight(profile, adminRole);
  const isNewVote = !existingVote;

  const { error: upsertError } = await supabaseAdmin.from('venue_votes').upsert(
    { user_id: user.id, venue_id: venueId, category: venue.category, vote, weight },
    { onConflict: 'user_id,venue_id,category' }
  );
  if (upsertError) return res.status(500).json({ error: 'Vote failed', detail: upsertError.message });

  // Only the first vote on a venue earns points — otherwise flipping a vote
  // back and forth would farm points indefinitely.
  if (isNewVote) {
    await awardPoints(supabaseAdmin, user.id, POINTS.VOTE, 'vote').catch(() => {});
  }

  const { data: updatedVenue } = await supabaseAdmin.from('venues').select('vote_score').eq('id', venueId).single();

  return res.status(200).json({
    success: true,
    vote_score: updatedVenue?.vote_score ?? null,
    pointsAwarded: isNewVote ? POINTS.VOTE : 0,
  });
}
