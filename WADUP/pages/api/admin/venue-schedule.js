import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity } from '../../../lib/admin';

const KINDS = new Set(['trivia','game_night','karaoke','live_music','special_event','happy_hour','food_special','other']);
const DAYS = new Set([0,1,2,3,4,5,6]);
const TIME = /^([01]\\d|2[0-3]):[0-5]\\d$/;
const DATE = /^\\d{4}-\\d{2}-\\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = value => typeof value === 'string' ? value.trim() : '';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });
  const { venueId, action, item } = req.body || {};
  if (!UUID.test(venueId || '')) return res.status(400).json({ error: 'Invalid venue' });
  const { data: venue } = await supabaseAdmin.from('venues').select('id,city').eq('id', venueId).maybeSingle();
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  if (!canAccessCity(auth.adminRole, venue.city)) return res.status(403).json({ error: 'Not authorized for this city' });

  if (action === 'list') {
    const { data, error } = await supabaseAdmin.from('venue_schedule_items').select('*').eq('venue_id', venueId).order('created_at');
    return error ? res.status(500).json({ error: error.message }) : res.json({ items: data });
  }
  if (action === 'delete') {
    if (!UUID.test(item?.id || '')) return res.status(400).json({ error: 'Invalid schedule item' });
    const { error } = await supabaseAdmin.from('venue_schedule_items').delete().eq('venue_id', venueId).eq('id', item.id);
    return error ? res.status(500).json({ error: error.message }) : res.json({ success: true });
  }
  if (action !== 'save') return res.status(400).json({ error: 'Unknown action' });
  const title = clean(item?.title);
  const kind = item?.kind;
  const recurrence = item?.recurrence;
  const weekdays = Array.isArray(item?.weekdays) ? [...new Set(item.weekdays)] : [];
  const date = clean(item?.event_date);
  const start = clean(item?.start_time);
  const end = clean(item?.end_time);
  const url = clean(item?.source_url);
  if (!title || title.length > 160 || !KINDS.has(kind) || !['weekly','one_time'].includes(recurrence) ||
      (recurrence === 'weekly' && (!weekdays.length || !weekdays.every(x => DAYS.has(x)))) ||
      (recurrence === 'one_time' && (!DATE.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00Z')))) ||
      (start && !TIME.test(start)) || (end && (!TIME.test(end) || !start)) ||
      (url && (!/^https?:\\/\\//i.test(url) || url.length > 2048))) {
    return res.status(400).json({ error: 'Check title, date, weekdays, times and source URL' });
  }
  const payload = {
    venue_id: venueId, title, kind, recurrence,
    weekdays: recurrence === 'weekly' ? weekdays : [],
    event_date: recurrence === 'one_time' ? date : null,
    start_time: start || null, end_time: end || null,
    description: clean(item.description).slice(0,3000),
    source_url: url || null,
    verified_at: item.verified ? new Date().toISOString() : null,
    is_active: item.is_active !== false,
    updated_at: new Date().toISOString(),
  };
  if (item.id) {
    if (!UUID.test(item.id)) return res.status(400).json({ error: 'Invalid item ID' });
    const { data, error } = await supabaseAdmin.from('venue_schedule_items').update(payload)
      .eq('venue_id', venueId).eq('id', item.id).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Schedule item not found' });
    return res.json({ item: data });
  }
  const { data, error } = await supabaseAdmin.from('venue_schedule_items').insert(payload).select().single();
  return error ? res.status(500).json({ error: error.message }) : res.json({ item: data });
}
