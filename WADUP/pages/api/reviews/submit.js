// pages/api/reviews/submit.js — POST { venue_id, overall_rating, subcategory_ratings, content }
// Replaces the old direct client-side `supabase.from('reviews').insert(...)`
// call (components/WriteReviewModal.js used to do this itself) so the
// category validation and the weighted-rating recalculation can both happen
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

  const { data: reviewVenue, error: venueError } = await supabaseAdmin.from('venues')
    .select('subcategories, subcategory, is_hidden').eq('id', venueId).single();
  if (venueError || !reviewVenue || reviewVenue.is_hidden) return res.status(404).json({ error: 'Venue not found' });
  const assigned = Array.isArray(reviewVenue.subcategories) && reviewVenue.subcategories.length
    ? reviewVenue.subcategories : (reviewVenue.subcategory ? [reviewVenue.subcategory] : []);
  const allowed = new Map(assigned.map(s => [String(s).trim().toLowerCase(), String(s).trim()]));
  let cleanSubcatRatings = {};
  if (subcategory_ratings && (typeof subcategory_ratings !== 'object' || Array.isArray(subcategory_ratings))) return res.status(400).json({ error: 'Invalid subcategory ratings' });
  if (subcategory_ratings && typeof subcategory_ratings === 'object') {
    for (const [subcat, val] of Object.entries(subcategory_ratings)) {
      const n = Number(val);
      const canonical = allowed.get(subcat.trim().toLowerCase());
      if (!canonical) return res.status(400).json({ error: 'This subcategory is not assigned to the venue: ' + subcat });
      if (!Number.isFinite(n) || n < 1 || n > 10) return res.status(400).json({ error: 'Invalid rating for ' + subcat });
      cleanSubcatRatings[canonical] = n;
    }
  }

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
