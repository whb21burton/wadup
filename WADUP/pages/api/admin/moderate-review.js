// pages/api/admin/moderate-review.js — the Reports/Moderation Queue's data
// source AND its actions. review_reports restricts SELECT to the reporting
// user's own rows (RLS), so listing every report — what an admin needs —
// has to go through the service-role client, same as the actions below.
//
// GET  -> list reports (super admin: all cities; ambassador: only reports
//         on reviews for venues in their assigned_cities)
// POST -> { reportId, action: 'dismiss' | 'remove_review' | 'suspend_user' }
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity, isSuperAdmin } from '../../../lib/admin';

const REPORT_SELECT = `
  id, reason, created_at,
  reporter:profiles!review_reports_reporter_id_fkey(username),
  reviews (
    id, content, overall_rating, user_id,
    author:profiles!reviews_user_id_fkey(username),
    venues (id, name, city, state)
  )
`;

export default async function handler(req, res) {
  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });
  const { adminRole } = auth;

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('review_reports')
      .select(REPORT_SELECT)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to load reports', detail: error.message });

    const reports = isSuperAdmin(adminRole)
      ? (data || [])
      : (data || []).filter(r => canAccessCity(adminRole, r.reviews?.venues?.city));

    return res.status(200).json({ reports });
  }

  if (req.method === 'POST') {
    const { reportId, action } = req.body || {};
    if (!reportId || !action) return res.status(400).json({ error: 'Missing reportId or action' });

    const { data: report, error: reportError } = await supabaseAdmin
      .from('review_reports')
      .select('id, review_id, reviews(id, user_id, venues(city))')
      .eq('id', reportId)
      .single();
    if (reportError || !report) return res.status(404).json({ error: 'Report not found' });

    const venueCity = report.reviews?.venues?.city;
    if (!canAccessCity(adminRole, venueCity)) {
      return res.status(403).json({ error: 'Not authorized for this city' });
    }

    if (action === 'dismiss') {
      const { error } = await supabaseAdmin.from('review_reports').delete().eq('id', reportId);
      if (error) return res.status(500).json({ error: 'Dismiss failed', detail: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'remove_review') {
      if (!report.review_id) return res.status(400).json({ error: 'Report has no linked review' });
      await supabaseAdmin.from('review_reports').delete().eq('review_id', report.review_id);
      const { error } = await supabaseAdmin.from('reviews').delete().eq('id', report.review_id);
      if (error) return res.status(500).json({ error: 'Remove review failed', detail: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'suspend_user') {
      const authorId = report.reviews?.user_id;
      if (!authorId) return res.status(400).json({ error: 'Report has no review author to suspend' });
      const { error } = await supabaseAdmin.from('profiles').update({ is_suspended: true }).eq('id', authorId);
      if (error) return res.status(500).json({ error: 'Suspend failed', detail: error.message });
      await supabaseAdmin.from('review_reports').delete().eq('id', reportId);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Unknown action "${action}"` });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
