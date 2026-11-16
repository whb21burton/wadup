import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';
import { canAccessCity } from '../../../lib/admin';

const KINDS = new Set(['trivia','game_night','karaoke','live_music','special_event','happy_hour','food_special','other']);
const DAYS = new Set([0,1,2,3,4,5,6]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = d => DATE.test(d || '') && !Number.isNaN(Date.parse(d+'T12:00:00Z'));
const validOccurrence = (row,date) => row.recurrence === 'one_time' ? row.event_date === date : (!row.starts_on || date >= row.starts_on) && (!row.ends_on || date <= row.ends_on) && (row.weekdays || []).includes(new Date(date+'T12:00:00Z').getUTCDay());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = value => typeof value === 'string' ? value.trim() : '';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { venueId, action, item } = req.method === 'GET' ? {venueId:req.query.venueId,action:'public'} : (req.body || {});
  if (!UUID.test(venueId || '')) return res.status(400).json({ error: 'Invalid venue' });
  const { data: venue } = await supabaseAdmin.from('venues').select('id,city,owner_id,is_hidden').eq('id', venueId).maybeSingle();
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  if (action === 'public') {
    if (venue.is_hidden) return res.status(404).json({error:'Venue not found'});
    const {data,error} = await supabaseAdmin.from('venue_schedule_items')
      .select('id,title,kind,recurrence,weekdays,event_date,start_time,end_time,description,source_url,verified_at,starts_on,ends_on,occurrence_overrides')
      .eq('venue_id',venueId).eq('is_active',true).order('created_at');
    return error ? res.status(500).json({error:'Unable to load schedule'}) : res.json({items:data||[]});
  }
  const auth = await requireAdmin(req);
  let authorized = !!auth && canAccessCity(auth.adminRole, venue.city);
  if (!authorized) {
    const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(token) {
      const {data:{user}}=await supabaseAdmin.auth.getUser(token);
      authorized=!!user && venue.owner_id===user.id;
    }
  }
  if (!authorized) return res.status(403).json({ error: 'Not authorized for this venue' });

  if (action === 'list') {
    const { data, error } = await supabaseAdmin.from('venue_schedule_items').select('*').eq('venue_id', venueId).order('created_at');
    return error ? res.status(500).json({ error: error.message }) : res.json({ items: data });
  }
  if (['cancel_occurrence','restore_occurrence','delete_occurrence','delete_future','cancel_future'].includes(action)) {
    if (!UUID.test(item?.id || '') || !validDate(item?.date)) return res.status(400).json({error:'Select a valid occurrence'});
    const {data:row,error:loadError}=await supabaseAdmin.from('venue_schedule_items').select('*').eq('venue_id',venueId).eq('id',item.id).maybeSingle();
    if(loadError) return res.status(500).json({error:'Could not load schedule'});
    if(!row) return res.status(404).json({error:'Schedule not found'});
    if(!validOccurrence(row,item.date)) return res.status(400).json({error:'Date is not part of this schedule'});
    const overrides={...(row.occurrence_overrides||{})};
    const now=new Date().toISOString();
    if(action==='cancel_occurrence') overrides[item.date]='canceled';
    if(action==='delete_occurrence') overrides[item.date]='deleted';
    if(action==='restore_occurrence') delete overrides[item.date];
    if(action==='delete_future'||action==='cancel_future') {
      if(row.recurrence==='one_time') {
        if(action==='delete_future') {
          const {error}=await supabaseAdmin.from('venue_schedule_items').delete().eq('id',row.id).eq('venue_id',venueId);
          return error?res.status(500).json({error:error.message}):res.json({success:true});
        }
        overrides[item.date]='canceled';
      } else {
        // Ending a recurring series is non-destructive: history remains.
        const previous=new Date(item.date+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
        const endDate=previous.toISOString().slice(0,10);
        const {error}=await supabaseAdmin.from('venue_schedule_items').update({ends_on:endDate,updated_at:now}).eq('id',row.id).eq('venue_id',venueId);
        return error?res.status(500).json({error:error.message}):res.json({success:true});
      }
    }
    const {error}=await supabaseAdmin.from('venue_schedule_items').update({occurrence_overrides:overrides,updated_at:now}).eq('id',row.id).eq('venue_id',venueId);
    return error?res.status(500).json({error:error.message}):res.json({success:true});
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
  const startsOn = clean(item?.starts_on);
  const endsOn = clean(item?.ends_on);
  if ((startsOn && !validDate(startsOn)) || (endsOn && !validDate(endsOn)) || (startsOn && endsOn && endsOn < startsOn) || (start && end && end <= start) || !title || title.length > 160 || !KINDS.has(kind) || !['weekly','one_time'].includes(recurrence) ||
      (recurrence === 'weekly' && (!weekdays.length || !weekdays.every(x => DAYS.has(x)))) ||
      (recurrence === 'one_time' && (!DATE.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00Z')))) ||
      (start && !TIME.test(start)) || (end && (!TIME.test(end) || !start)) ||
      (url && (!url.startsWith('https://') && !url.startsWith('http://') || url.length > 2048))) {
    return res.status(400).json({ error: 'Check title, date, weekdays, times and source URL' });
  }
  const payload = {
    venue_id: venueId, title, kind, recurrence,
    weekdays: recurrence === 'weekly' ? weekdays : [],
    starts_on: recurrence === 'weekly' ? (startsOn || null) : null,
    ends_on: recurrence === 'weekly' ? (endsOn || null) : null,
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
