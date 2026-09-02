// pages/api/places/auto-sync.js — called (fire-and-forget) from pages/index.js
// on every map load. Checks how long it's been since venues.last_google_sync
// was touched for Chattanooga; if it's been 7+ days (or never synced at
// all), it triggers the real sync (pages/api/places/sync.js) itself,
// server-to-server, using the same ADMIN_SYNC_PASSWORD the admin page's
// button sends — never exposed to the client, since this whole check runs
// server-side.
//
// The inner sync call is AWAITED here, not fired-and-forgotten — a plain
// unawaited fetch() from inside a Vercel serverless function isn't reliable:
// once this handler's response is sent, the function's execution can be
// frozen before an in-flight, un-awaited request even finishes sending
// (there's no ambient background-task guarantee without an explicit
// mechanism like @vercel/functions' waitUntil, which isn't a dependency
// here). Awaiting means this route's own response is only as fast as
// whatever's cached in venues.last_google_sync lets it be: instant on every
// call except the rare one that actually triggers a sync, which can take up
// to the sync route's own 60s budget — that's fine here, since the CLIENT
// call in pages/index.js doesn't wait on this response either.
import { supabaseAdmin } from '../supabase-admin';

const SYNC_INTERVAL_DAYS = 7;

function resolveAppUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select('last_google_sync')
    .eq('city', 'Chattanooga')
    .order('last_google_sync', { ascending: false, nullsFirst: false })
    .limit(1)
    .single();

  // PGRST116 = no rows matched .single() (e.g. an empty venues table) —
  // that's "never synced," not a real error, so it falls through to
  // daysSinceSync = Infinity below rather than failing the request.
  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: 'Failed to check last sync time', detail: error.message });
  }

  const lastSync = data?.last_google_sync ? new Date(data.last_google_sync) : null;
  const daysSinceSync = lastSync ? (Date.now() - lastSync.getTime()) / (1000 * 60 * 60 * 24) : Infinity;

  if (daysSinceSync < SYNC_INTERVAL_DAYS) {
    return res.status(200).json({ message: 'Sync not needed', daysSince: daysSinceSync });
  }

  if (!process.env.ADMIN_SYNC_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_SYNC_PASSWORD is not configured on the server' });
  }

  try {
    const syncRes = await fetch(`${resolveAppUrl()}/api/places/sync`, {
      method: 'POST',
      headers: { 'x-admin-password': process.env.ADMIN_SYNC_PASSWORD },
    });
    const syncData = await syncRes.json();
    if (!syncRes.ok) {
      return res.status(502).json({ message: 'Sync triggered but failed', detail: syncData });
    }
    return res.status(200).json({ message: 'Sync triggered', result: syncData });
  } catch (e) {
    console.error('Auto-sync failed:', e);
    return res.status(502).json({ message: 'Sync triggered but failed', detail: e.message });
  }
}
