// pages/api/reviews/submit.js — POST { venue_id, overall_rating, subcategory_ratings, content }
// Replaces the old direct client-side `supabase.from('reviews').insert(...)`
// call (components/WriteReviewModal.js used to do this itself) so the
// check-in gate and the weighted-rating recalculation can both happen
// server-side, atomically with the write, rather than trusting the client.
import { supabaseAdmin } from '../supabase-admin';
import { recalculateVenueRating } from '../../../lib/rankings';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Not signed in' });

  const { venue_id: venueId, overall_rating, subcategory_ratings, content } = req.body || {};
  if (!venueId) return res.status(400).json({ error: 'Missing venue_id' });

  const rating = Number(overall_rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    return res.status(400).json({ error: 'overall_rating must be a number between 1 and 10' });
  }

  let cleanSubcatRatings = {};
  if (subcategory_ratings && typeof subcategory_ratings === 'object') {
    for (const [subcat, val] of Object.entries(subcategory_ratings)) {
      const n = Number(val);
      if (typeof subcat === 'string' && subcat.trim() && Number.isFinite(n) && n >= 1 && n <= 10) {
        cleanSubcatRatings[subcat.trim()] = n;
      }
    }
  }

  // Checked-in is required, same rule the old vote system enforced —
  // checkins restricts SELECT to the acting user's own rows, which is
  // exactly what's needed here ("have I checked in", not "who has").
  const { data: checkin, error: checkinError } = await supabaseAdmin
    .from('checkins').select('id').eq('user_id', user.id).eq('venue_id', venueId).limit(1);
  if (checkinError) return res.status(500).json({ error: 'Failed to verify check-in', detail: checkinError.message });
  if (!checkin?.length) return res.status(403).json({ error: 'Check in first to leave a rating' });

  // One review per user per venue (reviews_user_id_venue_id_key) — upsert so
  // resubmitting edits the existing review instead of erroring.
  const { error: upsertError } = await supabaseAdmin.from('reviews').upsert(
    {
      user_id: user.id,
      venue_id: venueId,
      overall_rating: rating,
      subcategory_ratings: cleanSubcatRatings,
      content: content?.trim() || null,
    },
    { onConflict: 'user_id,venue_id' }
  );
  if (upsertError) return res.status(500).json({ error: 'Failed to save review', detail: upsertError.message });

  await recalculateVenueRating(supabaseAdmin, venueId);

  const { data: venue, error: venueError } = await supabaseAdmin
    .from('venues')
    .select('weighted_rating, weighted_rating_count, subcategory_weighted_ratings')
    .eq('id', venueId)
    .single();
  if (venueError) {
    return res.status(500).json({ error: 'Review saved, but failed to load the updated rating', detail: venueError.message });
  }

  return res.status(200).json({ success: true, venue });
}
