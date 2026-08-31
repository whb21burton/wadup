// pages/api/admin/pending-venues.js — lists venues_pending rows awaiting
// review for the admin venue manager's Pending Approval tab. venues_pending
// has RLS enabled with no policies at all (it's not meant to be publicly
// readable the way `venues` is), so — like every other admin/* route — this
// goes through supabaseAdmin (service role) rather than a client-side query.
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { isSuperAdmin } from '../../../lib/admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });

  let query = supabaseAdmin
    .from('venues_pending')
    .select('*')
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false });

  if (!isSuperAdmin(auth.adminRole)) {
    if (!auth.adminRole.cities?.length) return res.status(200).json({ pending: [] });
    query = query.in('city', auth.adminRole.cities);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Failed to load pending venues', detail: error.message });

  return res.status(200).json({ pending: data || [] });
}
