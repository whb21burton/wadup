-- A venue can legitimately be several things at once (a restaurant that is
-- both BBQ and Southern). venues.subcategory (text) is kept as the single
-- "primary" value — populated with subcategories[1] — so every existing
-- reader (map pins, discover cards, browse cards, search, rankings) keeps
-- working untouched.
alter table public.venues
  add column if not exists subcategories text[] not null default '{}'::text[];

-- Migrate the existing single value in, for every row that has one and
-- doesn't already have an array.
update public.venues
   set subcategories = array[subcategory]
 where subcategory is not null
   and btrim(subcategory) <> ''
   and coalesce(array_length(subcategories, 1), 0) = 0;

-- Makes the "venue has ANY of these subcategories" filter indexable if it
-- ever moves server-side (today the map filters client-side).
create index if not exists venues_subcategories_gin
  on public.venues using gin (subcategories);
