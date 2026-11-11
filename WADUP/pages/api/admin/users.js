// pages/api/admin/users.js — user lookups for the Ambassador Manager that
// need profiles.email, which the browser can no longer read (see the
// hide_profile_contact_fields migration). Super admin only, same as
// assign-ambassador.js.
//
// POST { action: 'search', q }        -> { users: [{ id, username, email, account_type }] }
// POST { action: 'list-ambassadors' } -> { ambassadors: [{ user_id, assigned_cities, profiles: { username, email } }] }
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { isSuperAdmin } from '../../../lib/admin';

const SEARCH_LIMIT = 10;

// ilike treats % and _ as wildcards — escape them so a search for "a_b"
// means exactly that.
function ilikePattern(q) {
  return `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });
  if (!isSuperAdmin(auth.adminRole)) return res.status(403).json({ error: 'Super admin only' });

  const { action, q } = req.body || {};

  if (action === 'list-ambassadors') {
    const { data, error } = await supabaseAdmin
      .from('admin_roles')
      .select('user_id, assigned_cities, profiles(username, email)')
      .eq('role', 'ambassador')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to load ambassadors', detail: error.message });
    return res.status(200).json({ ambassadors: data || [] });
  }

  if (action === 'search') {
    const term = typeof q === 'string' ? q.trim() : '';
    if (!term) return res.status(200).json({ users: [] });

    // Two plain ilike queries rather than one .or() string — the search term
    // never gets spliced into PostgREST filter syntax.
    const pattern = ilikePattern(term);
    const fields = 'id, username, email, account_type';
    const [byName, byEmail] = await Promise.all([
      supabaseAdmin.from('profiles').select(fields).ilike('username', pattern).limit(SEARCH_LIMIT),
      supabaseAdmin.from('profiles').select(fields).ilike('email', pattern).limit(SEARCH_LIMIT),
    ]);
    if (byName.error || byEmail.error) {
      return res.status(500).json({ error: 'Search failed', detail: (byName.error || byEmail.error).message });
    }

    const seen = new Set();
    const users = [...byName.data, ...byEmail.data].filter(u => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    }).slice(0, SEARCH_LIMIT);
    return res.status(200).json({ users });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
