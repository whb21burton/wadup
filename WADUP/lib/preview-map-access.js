import { pacificMonth } from './google-sku-budget.js';

const BRANCH = 'development/official-event-integrations';
const PROJECT = 'prj_bk1MksQYd5HEyXjj7tv3mudVy4j7';
const MINUTE = 60_000;

export function isMapTestDeployment(env) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_PROJECT_ID === PROJECT &&
    env.VERCEL_GIT_COMMIT_REF === BRANCH;
}

export function previewMapKey(origin, env, now = Date.now()) {
  const key = env.WADUP_PREVIEW_MAPS_KEY;
  if (!isMapTestDeployment(env) || !env.VERCEL_BRANCH_URL ||
      origin.origin !== `https://${env.VERCEL_BRANCH_URL}` ||
      !/^[A-Za-z0-9_-]{20,128}$/.test(key || '')) return null;

  let allowance;
  try {
    allowance = JSON.parse(env.WADUP_PREVIEW_MAPS_WINDOW);
  } catch {
    return null;
  }
  if (!allowance) return null;
  const { startsAt, endsAt, mapLoadsPerMinute, freeMapLoadsRemaining } = allowance;
  const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  if (!utcTimestamp.test(startsAt || '') || !utcTimestamp.test(endsAt || '')) return null;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const duration = end - start;
  if (!(start <= now && now < end && duration <= 60 * MINUTE) ||
      pacificMonth(new Date(start)) !== pacificMonth(new Date(end - 1))) return null;
  if (!Number.isInteger(mapLoadsPerMinute) || mapLoadsPerMinute < 1 || mapLoadsPerMinute > 5) return null;

  // The operator confirms the provider limit and free headroom. Allow for a
  // minute boundary and quota-versus-billing variance in the planned window.
  const required = Math.ceil((Math.ceil(duration / MINUTE) + 1) * mapLoadsPerMinute * 1.25);
  if (!Number.isInteger(freeMapLoadsRemaining) || freeMapLoadsRemaining < required || freeMapLoadsRemaining > 9000) return null;
  return key;
}
