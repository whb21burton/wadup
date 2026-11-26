export function canRunLegacyCron(headers, env = process.env) {
  return Boolean(
    (env.CRON_SECRET && headers.authorization === `Bearer ${env.CRON_SECRET}`) ||
    (env.ADMIN_SYNC_PASSWORD && headers['x-admin-password'] === env.ADMIN_SYNC_PASSWORD)
  );
}

export async function loadCronDatabase() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, VERCEL_ENV: environment } = process.env;
  if (!url || !key) return null;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return null; }
  if (environment === 'preview' && hostname === 'lnuzfkcugoyhsfzrvyrv.supabase.co') return null;
  const { supabaseAdmin } = await import('../pages/api/supabase-admin');
  return supabaseAdmin;
}
