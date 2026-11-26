import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { isSuperAdmin } from '../../../lib/admin';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const auth = await requireAdmin(req);
  if (!isSuperAdmin(auth?.adminRole)) return res.status(403).json({ error: 'Super admin only' });

  const { action, query } = req.body || {};
  if (action === 'list') {
    const { data, error } = await supabaseAdmin
      .from('admin_roles')
      .select('user_id, assigned_cities, profiles(username, email)')
      .eq('role', 'ambassador')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Could not load ambassadors' });
    return res.json({ users: data });
  }

  const search = typeof query === 'string' ? query.trim() : '';
  if (action !== 'search' || !search || search.length > 160) {
    return res.status(400).json({ error: 'Enter a username or email to search' });
  }
  const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
  const result = await Promise.all(['username', 'email'].map(column => supabaseAdmin
    .from('profiles')
    .select('id, username, email, account_type')
    .ilike(column, pattern)
    .order('id')
    .limit(10)));
  if (result.some(({ error }) => error)) return res.status(500).json({ error: 'Could not search users' });
  const users = [...new Map(result.flatMap(({ data }) => data).map(user => [user.id, user])).values()];
  return res.json({ users: users.slice(0, 10) });
}
