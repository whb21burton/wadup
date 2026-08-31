// lib/admin.js — admin role lookups + scope checks, shared by client admin
// pages and server-side /api/admin/* routes.
const SUPER_ADMIN_EMAIL = 'whb21burton@gmail.com';

// Returns null | { role: 'super_admin', cities: null, states: null }
//             | { role: 'ambassador', cities: string[], states: string[] }
// `supabase` can be the regular anon/session client (admin_roles' RLS lets a
// user read their own row) or the service-role admin client (server routes).
export async function getAdminRole(supabase, userId) {
  if (!userId) {
    console.log('[admin] getAdminRole: no userId given');
    return null;
  }
  const { data, error } = await supabase
    .from('admin_roles')
    .select('role, assigned_cities, assigned_states')
    .eq('user_id', userId)
    .maybeSingle();

  console.log('[admin] getAdminRole for', userId, '-> data:', data, 'error:', error?.message || null);

  if (error || !data) return null;

  if (data.role === 'super_admin') return { role: 'super_admin', cities: null, states: null };
  return { role: 'ambassador', cities: data.assigned_cities || [], states: data.assigned_states || [] };
}

export function isSuperAdmin(adminRole) {
  return adminRole?.role === 'super_admin';
}

export function canAccessCity(adminRole, city) {
  if (!adminRole) return false;
  if (adminRole.role === 'super_admin') return true;
  return !!city && (adminRole.cities || []).includes(city);
}

export function canAccessState(adminRole, state) {
  if (!adminRole) return false;
  if (adminRole.role === 'super_admin') return true;
  return !!state && (adminRole.states || []).includes(state);
}

export { SUPER_ADMIN_EMAIL };
