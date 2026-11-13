-- Read-only full venue classification audit for Chattanooga and surrounding towns.
-- This intentionally does NOT publish pending records or guess whether venues are open.
SELECT v.id,v.name,v.city,v.state,v.address,v.category,v.categories,
       v.subcategory,v.subcategories,v.custom_emoji,v.is_hidden,
       CASE
         WHEN v.name ~* 'dread hollow|haunted|haunt' THEN 'SEASONAL: show only with verified active event'
         WHEN v.category='sports' THEN 'MOVE TO ACTIVITIES if public recreation; Sports chip is dated competition'
         WHEN v.category='nightlife' AND v.subcategory IN ('Bar','Cocktail Bar','Live Music')
           THEN 'REVIEW nightlife subtype; avoid assuming speakeasy or dive bar'
         WHEN v.category='activities' AND v.subcategory IN ('Things To Do','Arcades & Games')
           THEN 'REVIEW specific activities and multiple tags'
         WHEN v.category='outdoors' AND v.subcategory IN ('Parks & Nature','Historic Sites')
           THEN 'REVIEW public access, park/trail/dog park and historic attraction'
         WHEN v.category='restaurant' AND lower(v.subcategory) LIKE '%restaurant%'
           THEN 'NORMALIZE legacy Google primary type for filter compatibility'
         ELSE 'CHECK'
       END AS audit_action
FROM public.venues v
ORDER BY v.category,v.city,v.name;

-- Missing-venue candidate check (do not insert until operational status is confirmed).
SELECT p.id,p.name,p.address,p.category,p.subcategory,p.status
FROM public.venues_pending p
WHERE p.status='pending'
ORDER BY p.category,p.name;

-- All Ticketmaster sport classifications, including genres the UI should support.
SELECT segment,genre,sub_genre,count(*) AS events,
       count(*) FILTER (WHERE sport_emoji IS NULL OR sport_emoji='🏟️') AS generic_emoji
FROM public.tm_events_cache WHERE cat='sports'
GROUP BY 1,2,3 ORDER BY events DESC;
