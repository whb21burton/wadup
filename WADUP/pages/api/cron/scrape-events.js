// pages/api/cron/scrape-events.js — runs biweekly (see vercel.json), visits
// each scraping_enabled venue's scraping_url, and asks Claude to extract
// upcoming events from the page text. High-confidence events (>=80) go
// straight into venue_events; everything else lands in
// scraped_events_pending for an admin to review (see pages/admin/reports.js).
import { supabaseAdmin } from '../supabase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const EVENT_TYPES = ['live_music', 'trivia', 'dj', 'comedy', 'karaoke', 'other'];

// Structured outputs (client.messages.parse + a Zod schema) rather than
// "return ONLY JSON" + regex-extracting a code block — Claude's response is
// validated against this schema server-side, so there's no hand-rolled
// JSON.parse/regex fallback that can silently hand back garbage.
const EventSchema = z.object({
  event_name: z.string(),
  event_date: z.string().nullable(), // YYYY-MM-DD
  event_time: z.string().nullable(), // HH:MM, 24hr
  performer: z.string().nullable(),
  event_type: z.enum(EVENT_TYPES),
  description: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
});
const EventsSchema = z.object({ events: z.array(EventSchema) });

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
      req.headers['x-admin-password'] !== process.env.ADMIN_SYNC_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
  }

  const { data: venues, error: venuesError } = await supabaseAdmin
    .from('venues')
    .select('id, name, scraping_url, city, state')
    .eq('scraping_enabled', true)
    .not('scraping_url', 'is', null);
  if (venuesError) return res.status(500).json({ error: 'Failed to load venues', detail: venuesError.message });

  if (!venues?.length) {
    return res.status(200).json({ message: 'No venues enabled for scraping' });
  }

  const client = new Anthropic();
  const todayIso = new Date().toISOString().slice(0, 10);
  const results = { scraped: 0, events_found: 0, saved_live: 0, saved_pending: 0, errors: [] };

  for (const venue of venues) {
    try {
      const pageRes = await fetch(venue.scraping_url, {
        headers: { 'User-Agent': 'WadUp Event Bot/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);
      const html = await pageRes.text();

      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8000); // keep the request small — this is a cost-bounded bulk cron, not a one-off

      const response = await client.messages.parse({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `Extract upcoming events from this venue's website text.

Venue: ${venue.name} in ${venue.city}, ${venue.state}
Today's date: ${todayIso}

Website text:
${text}

Only include FUTURE events (strictly after today's date). If a date can't be determined, use null for event_date rather than guessing. If no events are found, return an empty events array.`,
        }],
        output_config: { format: zodOutputFormat(EventsSchema) },
      });

      const events = response.parsed_output?.events ?? [];

      for (const ev of events) {
        if (!ev.event_date || !DATE_RE.test(ev.event_date) || ev.event_date <= todayIso) continue;
        const validTime = ev.event_time && TIME_RE.test(ev.event_time) ? ev.event_time : null;

        if (ev.confidence >= 80) {
          const { error } = await supabaseAdmin.from('venue_events').upsert({
            venue_id: venue.id,
            title: ev.event_name || ev.performer || 'Event',
            description: ev.description || '',
            event_type: ev.event_type,
            start_time: `${ev.event_date}T${validTime || '20:00'}:00`,
            is_free: false,
            source: 'scraped',
          }, { onConflict: 'venue_id,start_time' });
          if (error) throw new Error(`venue_events upsert: ${error.message}`);
          results.saved_live++;
        } else {
          const { error } = await supabaseAdmin.from('scraped_events_pending').insert({
            venue_id: venue.id,
            venue_name: venue.name,
            event_name: ev.event_name || ev.performer || 'Unknown Event',
            event_date: ev.event_date,
            event_time: validTime,
            performer: ev.performer,
            event_type: ev.event_type,
            description: ev.description,
            confidence: ev.confidence,
            raw_text: text,
            source_url: venue.scraping_url,
          });
          if (error) throw new Error(`scraped_events_pending insert: ${error.message}`);
          results.saved_pending++;
        }
        results.events_found++;
      }

      await supabaseAdmin.from('venues')
        .update({ last_scraped_at: new Date().toISOString() })
        .eq('id', venue.id);

      results.scraped++;
    } catch (err) {
      results.errors.push({ venue: venue.name, error: err.message });
    }
  }

  return res.status(200).json(results);
}

export const config = { maxDuration: 300 };
