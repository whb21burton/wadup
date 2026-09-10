// pages/api/cron/sync-tm-events.js — runs every 2 hours (see vercel.json),
// fetches Ticketmaster events across every TM_REGIONS city, and replaces
// the contents of tm_events_cache. pages/index.js reads THAT table instead
// of calling Ticketmaster directly — this is what makes nationwide coverage
// affordable: 43 TM API calls every 2 hours from this one cron run, not 43
// calls from every single visitor's browser (which is what the coverage
// expansion would have cost before this).
import { supabaseAdmin } from '../supabase-admin';
import { TM_REGIONS, tmSegmentToCat, tmSportEmoji } from '../../../lib/data';

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
      req.headers['x-admin-password'] !== process.env.ADMIN_SYNC_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Same key pages/api/tm.js already uses in production (TM_KEY was never
  // actually set as an env var there either — this fallback literal IS the
  // real, currently-working key, not a placeholder).
  const TM_KEY = process.env.TM_KEY || 'Ahrx6q7enx8cRnx2Vm12Z1Gj1UaDsTeH';
  const now = new Date();
  const future = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000); // 6 months
  const startDT = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const endDT = future.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const seen = new Set();
  const allEvents = [];
  const errors = [];

  const fetchRegion = async (region) => {
    try {
      const qs = new URLSearchParams({
        apikey: TM_KEY,
        size: 200,
        sort: 'date,asc',
        radius: 150,
        unit: 'miles',
        latlong: `${region.lat},${region.lng}`,
        startDateTime: startDT,
        endDateTime: endDT,
      });
      const res2 = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${qs}`);
      const data = await res2.json();
      const events = data._embedded?.events || [];

      events.forEach((ev) => {
        if (seen.has(ev.id)) return;
        seen.add(ev.id);

        const ven = ev._embedded?.venues?.[0] || {};
        const loc = ven.location || {};
        const lng = parseFloat(loc.longitude);
        const lat = parseFloat(loc.latitude);
        if (isNaN(lng) || isNaN(lat)) return;

        const dateStr = ev.dates?.start?.localDate || '';
        const timeStr = ev.dates?.start?.localTime || '';
        const classification = ev.classifications?.[0] || {};
        const segment = classification.segment?.name || '';
        const genre = classification.genre?.name || '';
        const subGenre = classification.subGenre?.name || '';
        // Computed here (server-side, from the real classifications array —
        // including .type, which tmSegmentToCat also reads) rather than in
        // pages/index.js, so the client never has to reconstruct a fake
        // classifications array from flattened cache columns.
        const cat = tmSegmentToCat(ev.classifications, ev.name);
        const sportEmoji = cat === 'sports' ? tmSportEmoji({ segment, genre, subGenre, name: ev.name }) : null;

        let price = '';
        if (ev.priceRanges?.[0]) {
          const pr = ev.priceRanges[0];
          price = `$${Math.round(pr.min)}${pr.max && pr.max !== pr.min ? ` – $${Math.round(pr.max)}` : ''}`;
        }

        allEvents.push({
          tm_id: ev.id,
          name: ev.name,
          segment,
          genre,
          sub_genre: subGenre,
          cat,
          sport_emoji: sportEmoji,
          date_str: dateStr,
          time_str: timeStr,
          lat,
          lng,
          venue_name: ven.displayName || ven.name || '',
          city: ven.city?.name || '',
          state: ven.state?.stateCode || '',
          address: ven.address?.line1 || '',
          price,
          url: ev.url || '',
          image_url: (ev.images?.find(i => i.ratio === '16_9' && i.width > 500) || ev.images?.[0])?.url || '',
          cached_at: now.toISOString(),
        });
      });
    } catch (e) {
      errors.push(`${region.lat},${region.lng}: ${e.message}`);
    }
  };

  const BATCH_SIZE = 8;
  for (let i = 0; i < TM_REGIONS.length; i += BATCH_SIZE) {
    const batch = TM_REGIONS.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(fetchRegion));
  }

  // Full replace — this table is purely a cache with nothing else
  // referencing it by foreign key, so delete-then-reinsert is safe and
  // simplest.
  const { error: deleteError } = await supabaseAdmin.from('tm_events_cache').delete().neq('tm_id', 'placeholder');
  if (deleteError) {
    return res.status(500).json({ error: 'Failed to clear old cache', detail: deleteError.message });
  }

  for (let i = 0; i < allEvents.length; i += 500) {
    const batch = allEvents.slice(i, i + 500);
    const { error: insertError } = await supabaseAdmin.from('tm_events_cache').insert(batch);
    if (insertError) {
      return res.status(500).json({ error: 'Failed to insert events', detail: insertError.message, insertedBeforeFailure: i });
    }
  }

  return res.status(200).json({
    success: true,
    total: allEvents.length,
    regions: TM_REGIONS.length,
    errors,
    cachedAt: now.toISOString(),
  });
}

// Cron jobs run outside the request/response cycle a normal page hit uses,
// so this can safely take longer than a typical API route — 43 regions in
// batches of 8 comfortably needs more than the default 10s. NOTE: Vercel's
// Hobby plan caps ALL function execution (cron included) at 60s regardless
// of this setting — this only actually unlocks 300s on a Pro-or-higher plan.
export const config = { maxDuration: 300 };
