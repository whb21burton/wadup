import { requireAdmin } from './_authAdmin';
import { supabaseAdmin } from '../supabase-admin';
import { isSuperAdmin } from '../../../lib/admin';

// Only the super admin can adjust the editorial 10-review-equivalent prior.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireAdmin(req);
  if (!auth || !isSuperAdmin(auth.adminRole)) return res.status(403).json({ error: 'Super admin only' });
  const { updates } = req.body || {};
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > 100)
    return res.status(400).json({ error: 'Expected 1-100 venue score updates' });
  const ids = new Set();
  for (const item of updates) {
    if (!item || !/^[0-9a-f-]{36}$/i.test(String(item.id)) ||
        ids.has(item.id) || typeof item.score !== 'number' ||
        !Number.isFinite(item.score) || item.score < 0 || item.score > 10)
      return res.status(400).json({ error: 'Invalid or duplicate venue score' });
    ids.add(item.id);
  }
  // Writes are scoped to a known set of venue IDs; user review data is untouched.
  // Updates are independent, so report partial failures rather than claiming success.
  let saved = 0;
  for (const item of updates) {
    const { data, error } = await supabaseAdmin.from('venues')
      .update({ admin_rating: Math.round(item.score * 100) / 100 })
      .eq('id', item.id).select('id').single();
    if (error || !data) return res.status(500).json({ error: 'Could not save all scores', saved });
    saved++;
  }
  return res.status(200).json({ saved });
}
