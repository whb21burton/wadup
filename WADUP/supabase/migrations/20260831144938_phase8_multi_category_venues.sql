alter table venues add column if not exists categories text[] default '{}';

update venues set categories = array[category]
where category is not null and (categories is null or categories = '{}');

-- The `&&` overlap operator (used throughout the app for "does this venue
-- have any of these categories") benefits from a GIN index at scale.
create index if not exists venues_categories_gin_idx on venues using gin(categories);
