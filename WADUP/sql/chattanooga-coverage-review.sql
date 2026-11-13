-- Chattanooga expansion review: read-only, zero Google API calls.
-- Run against Supabase to identify unique candidates before approval.
-- Approved historical rows remain intact for auditability.
WITH pending_review AS (
  SELECT p.*, EXISTS (
    SELECT 1 FROM public.venues v
    WHERE p.google_place_id IS NOT NULL
      AND v.google_place_id = p.google_place_id
  ) AS already_live
  FROM public.venues_pending p
)
SELECT category,
       count(*) FILTER (WHERE status = 'pending' AND NOT already_live) AS needs_review,
       count(*) FILTER (WHERE already_live) AS matched_live,
       count(*) FILTER (WHERE status = 'pending' AND NOT already_live AND website IS NOT NULL AND website <> '') AS with_website,
       count(*) FILTER (WHERE status = 'pending' AND NOT already_live AND lat IS NOT NULL AND lng IS NOT NULL) AS with_coordinates
FROM pending_review
GROUP BY category ORDER BY needs_review DESC;

-- Geographic gap report (stored city may not reflect the actual neighborhood):
SELECT city, category, count(*) AS live_count
FROM public.venues
WHERE lower(state) IN ('tn','ga')
GROUP BY city, category
ORDER BY city, category;

-- Pending events-category records are VENUES, not dated events.
-- Review each for correct primary category before publishing.
SELECT id,name,address,city,category,website,google_place_id
FROM public.venues_pending p
WHERE status='pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.venues v WHERE v.google_place_id=p.google_place_id
  )
ORDER BY category,name;
