// pages/api/points/award.js — awards points, called internally.
//
// This is deliberately NOT a generic "award me N points for any reason"
// endpoint: every reason but DAILY_LOGIN corresponds to an action the app
// can already verify server-side at its own point of occurrence (check-in →
// pages/api/checkin.js calls awardPoints() directly; a future review/photo/
// referral flow would do the same from its own route). Exposing this route
// as a free-for-all would let any signed-in user farm points by POSTing
// {reason:"REFER_FRIEND"} on a loop. DAILY_LOGIN is the one reason that's
// safe to self-report here, since the once-per-day check below bounds it.
import { supabaseAdmin } from '../supabase-admin';
import { awardPoints, POINTS } from '../../../lib/rankings';

const SELF_SERVICE_REASONS = new Set(['DAILY_LOGIN']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Not signed in' });

  const { reason } = req.body || {};
  if (!SELF_SERVICE_REASONS.has(reason)) {
    return res.status(403).json({ error: `"${reason}" is not self-awardable through this endpoint` });
  }

  if (reason === 'DAILY_LOGIN') {
    const todayStartIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    const { data: awardedToday, error: checkError } = await supabaseAdmin
      .from('points_log')
      .select('id')
      .eq('user_id', user.id)
      .eq('reason', 'daily_login')
      .gte('created_at', todayStartIso)
      .limit(1);
    if (checkError) return res.status(500).json({ error: 'Points award failed' });
    if (awardedToday && awardedToday.length) {
      return res.status(409).json({ error: 'Daily login bonus already claimed today' });
    }
  }

  try {
    const newTotal = await awardPoints(supabaseAdmin, user.id, POINTS[reason], reason.toLowerCase());
    return res.status(200).json({ success: true, pointsAwarded: POINTS[reason], newTotal });
  } catch (e) {
    return res.status(500).json({ error: 'Points award failed' });
  }
}
