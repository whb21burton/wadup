import assert from 'node:assert/strict';
import {EVENT_VENUES} from '../lib/event-venues.js';

const base = new URL(process.env.WADUP_BROWSER_URL);
const secret = process.env.VENUE_SYNC_VERIFY_SECRET;
const identity = process.env.VERCEL_OIDC_TOKEN;
if (base.protocol !== 'https:' || !/^[a-z0-9-]+-whb21burtons-projects\.vercel\.app$/.test(base.hostname) ||
    base.username || base.password || !secret || !identity) throw Error('Protected WADUP preview and authorized verification credentials required');
const endpoint = new URL('/api/cron/sync-venue-schedules?verify=1',base);
const headers = {'x-vercel-trusted-oidc-idp-token':identity};
const unauthorized=await fetch(endpoint,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(15000)});
assert.equal(unauthorized.status,401,'Preview must reject requests without the dedicated verifier secret');
const result=await fetch(endpoint,{method:'POST',headers:{...headers,Authorization:'Bearer '+secret},
  redirect:'error',signal:AbortSignal.timeout(70000)});
const data=await result.json();
assert.equal(data.mode,'verification','Response must attest that only adapter verification was executed');
assert.deepEqual(data.results.map(row=>row.venue),EVENT_VENUES.map(venue=>venue.id));
for (const {venue,status,count,complete,hasCanonicalLocation} of data.results) {
  console.log(JSON.stringify({venue,status,count,complete,hasCanonicalLocation}));
}
assert.equal(result.status,200,'At least one hosted adapter was incomplete');
assert.ok(data.results.every(row=>row.complete && row.count>0 && row.hasCanonicalLocation));
console.log(`Protected preview verified ${data.results.reduce((n,row)=>n+row.count,0)} current performances without database access`);
