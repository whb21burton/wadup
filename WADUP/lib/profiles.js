// lib/profiles.js — which profiles columns each reader is allowed to select,
// plus the server-side suspension check shared by the user-facing API routes.
//
// email and phone are not selectable by anon or authenticated (column-level
// grants, see the hide_profile_contact_fields migration), so a select('*')
// on profiles from the browser fails outright. Always select one of these.

// The signed-in user's own profile (AuthSidebar badge, discover's default
// city, review/edit forms). account_type is only granted to authenticated.
export const OWN_PROFILE_FIELDS = 'id, username, city, is_local, account_type, created_at';

// Someone else's profile — must stay within anon's grant too, since
// pages/profile/[username].js renders for logged-out visitors.
export const PUBLIC_PROFILE_FIELDS = 'id, username, city, is_local, created_at';

// `supabaseAdmin` must be the service-role client — is_suspended isn't
// selectable by anon/authenticated. A missing profile row counts as not
// suspended, matching private.is_active_user() in the database.
export async function isSuspended(supabaseAdmin, userId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('is_suspended')
    .eq('id', userId)
    .maybeSingle();
  return !!data?.is_suspended;
}
