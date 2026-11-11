// Wadup 10-point score engine. Google is a seed, never represented as a Wadup user review.
export const ADMIN_PRIOR_WEIGHT = 10;
export const clampScore = x => Math.max(0, Math.min(10, Number(x) || 0));

// Shrink low-volume Google averages toward a neutral 3.8/5 baseline.
// The review count influences confidence, not the number of Wadup reviews.
export function googleSeedScore(rating, reviewCount = 0) {
  if (rating == null || !Number.isFinite(Number(rating))) return 7.0;
  const n = Math.max(0, Number(reviewCount) || 0);
  const adjusted = (n * Number(rating) + 50 * 3.8) / (n + 50);
  return Math.round(clampScore(adjusted * 2) * 100) / 100;
}

export function adminBaseline(venue) {
  return venue?.admin_rating != null
    ? clampScore(venue.admin_rating)
    : googleSeedScore(venue?.google_rating, venue?.google_review_count);
}

export function wadupScore(venue) {
  const n = Math.max(0, Number(venue?.total_ratings) || 0);
  const average = Number(venue?.average_rating);
  const userAverage = Number.isFinite(average) ? clampScore(average) : null;
  const base = adminBaseline(venue);
  return n > 0 && userAverage != null
    ? (ADMIN_PRIOR_WEIGHT * base + n * userAverage) / (ADMIN_PRIOR_WEIGHT + n)
    : base;
}

// Reordering changes only the admin baseline, not user review data.
// If adjacent scores are equal, use 0.01-point precision and flag ties in UI.
export function scoreBetween(above, below) {
  if (above == null && below == null) return 7;
  if (above == null) return clampScore(Number(below) + 0.5);
  if (below == null) return clampScore(Number(above) - 0.5);
  return Math.round(((Number(above) + Number(below)) / 2) * 100) / 100;
}
