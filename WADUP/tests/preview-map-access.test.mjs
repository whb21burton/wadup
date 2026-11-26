import assert from 'node:assert/strict';
import test from 'node:test';
import { previewMapKey } from '../lib/preview-map-access.js';

const branchHost = 'wadup-git-feature-team.vercel.app';
const origin = new URL(`https://${branchHost}`);
const window = {
  startsAt: '2026-11-25T20:00:00Z',
  endsAt: '2026-11-25T20:30:00Z',
  mapLoadsPerMinute: 2,
  freeMapLoadsRemaining: 100,
};
const now = Date.parse(window.startsAt);
const env = {
  VERCEL_ENV: 'preview',
  VERCEL_BRANCH_URL: branchHost,
  VERCEL_PROJECT_ID: 'prj_bk1MksQYd5HEyXjj7tv3mudVy4j7',
  VERCEL_GIT_COMMIT_REF: 'development/official-event-integrations',
  WADUP_PREVIEW_MAPS_KEY: 'fixture-browser-key-never-sent',
  WADUP_PREVIEW_MAPS_WINDOW: JSON.stringify(window),
};
const admit = (changes) => previewMapKey(origin, {
  ...env, WADUP_PREVIEW_MAPS_WINDOW: JSON.stringify({...window,...changes}),
}, now);

test('approved quota window returns its browser key without a billing report', () => {
  assert.equal(previewMapKey(origin, env, now), env.WADUP_PREVIEW_MAPS_KEY);
  assert.equal(previewMapKey(origin, env, Date.parse(window.endsAt) - 1), env.WADUP_PREVIEW_MAPS_KEY);
});

test('production, other projects, branches and origins cannot use the preview override', () => {
  for (const changes of [
    { VERCEL_ENV: 'production' },
    { VERCEL_PROJECT_ID: 'another-project' },
    { VERCEL_GIT_COMMIT_REF: 'another-preview' },
    { VERCEL_BRANCH_URL: '' },
  ]) assert.equal(previewMapKey(origin,{...env,...changes},now),null);
  assert.equal(previewMapKey(new URL('https://wadup.app'),env,now),null);
  assert.equal(previewMapKey(new URL(`http://${branchHost}`),env,now),null);
});

test('missing configuration, malformed, early and expired windows fail closed', () => {
  for (const changes of [
    { WADUP_PREVIEW_MAPS_KEY: '' },
    { WADUP_PREVIEW_MAPS_WINDOW: '{' },
    { WADUP_PREVIEW_MAPS_WINDOW: 'null' },
  ]) assert.equal(previewMapKey(origin,{...env,...changes},now),null);
  assert.equal(previewMapKey(origin,env,now-1),null);
  assert.equal(previewMapKey(origin,env,Date.parse(window.endsAt)),null);
});

test('rejects loose quotas, inadequate headroom, long windows and Pacific month rollover', () => {
  for (const changes of [
    { mapLoadsPerMinute: 6 },
    { mapLoadsPerMinute: '2' },
    { freeMapLoadsRemaining: 77 },
    { freeMapLoadsRemaining: 9001 },
    { endsAt: '2026-11-25T21:00:01Z' },
  ]) assert.equal(admit(changes),null);
  assert.equal(admit({freeMapLoadsRemaining:78}),env.WADUP_PREVIEW_MAPS_KEY);
  assert.equal(previewMapKey(origin,{
    ...env,
    WADUP_PREVIEW_MAPS_WINDOW:JSON.stringify({
      ...window,startsAt:'2026-12-01T07:45:00Z',endsAt:'2026-12-01T08:15:00Z',
    }),
  },Date.parse('2026-12-01T07:50:00Z')),null);
});
