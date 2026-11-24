// pages/api/admin/review-scraped-event.js — approve/reject one row from the
// scraped_events_pending review queue (see pages/admin/reports.js's
// "Scraped Events" tab).
import { supabaseAdmin } from '../supabase-admin';
import { requireAdmin } from './_authAdmin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAdmin(req);
  if (!auth) return res.status(403).json({ error: 'Not authorized' });

  const { event_id, action } = req.body || {};
  if (!event_id || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Missing event_id or invalid action' });
  }

  const { data: pending, error: fetchError } = await supabaseAdmin
    .from('scraped_events_pending')
    .select('*')
    .eq('id', event_id)
    .single();
  if (fetchError || !pending) return res.status(404).json({ error: 'Scraped event not found' });

  if (action === 'approve') {
    if (!pending.event_time || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(pending.event_time)) {
      return res.status(422).json({ error: 'A verified event start time is required to approve this event' });
    }
    const { error: insertError } = await supabaseAdmin.from('venue_events').upsert({
      venue_id: pending.venue_id,
      title: pending.event_name,
      description: pending.description || '',
      event_type: pending.event_type || 'other',
      performer: pending.performer || null,
      start_time: `${pending.event_date}T${pending.event_time}`,
      is_free: false,
      source: 'scraped',
    }, { onConflict: 'venue_id,start_time' });
    if (insertError) return res.status(500).json({ error: 'Failed to add event', detail: insertError.message });
  }

  const { error: updateError } = await supabaseAdmin
    .from('scraped_events_pending')
    .update({ status: action === 'approve' ? 'approved' : 'rejected' })
    .eq('id', event_id);
  if (updateError) return res.status(500).json({ error: 'Failed to update status', detail: updateError.message });

  return res.status(200).json({ success: true });
}
