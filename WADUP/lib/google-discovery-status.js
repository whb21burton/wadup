import {pacificMonth, summarizeGoogleUsage} from './google-sku-budget.js';
import {DISCOVERY_SEARCHES_PER_SLOT, DISCOVERY_SLOT_MINUTES, discoveryRegions} from './google-discovery-plan.js';

export async function readGoogleDiscoveryStatus(db, now = new Date()) {
  const {data, error} = await db.rpc('read_google_usage_summary');
  const reports = Object.fromEntries(Object.entries(data?.units || {}).map(([id, units]) =>
    [id, {units, coveredThrough:data.covered_through}]));
  const guardedSkus=['FAF4-3B2D-51B2','BAC8-4E68-E261','772E-9975-BE34','E967-44BC-B44D','EB23-5ECC-F753','DCD1-FE97-8C71'];
  const pending = Object.fromEntries(guardedSkus.map(id => [id, data?.covered_through ? data.outstanding_skus?.[id] ?? 0 : null]));
  pending['99F9-A108-83A6']=data?.outstanding ?? null;
  const skus = summarizeGoogleUsage(reports, pending, now);
  const nearby = skus.find(sku => sku.id === '99F9-A108-83A6');
  const receivedAge = now.getTime() - Date.parse(data?.received_at);
  const feedAvailable = !error && nearby.fresh && receivedAge >= 0 && receivedAge < 6 * 3600000;
  const regions = discoveryRegions(process.env.GOOGLE_DISCOVERY_REGIONS, process.env.GOOGLE_DISCOVERY_REGION);
  const configured = process.env.GOOGLE_PLACES_FREE_BUDGET_VERIFIED === 'true' &&
    Boolean(process.env.GOOGLE_DISCOVERY_KEY && regions.length);
  return {month:pacificMonth(now), skus, candidateIds:data?.candidate_ids ?? null,
    feedAvailable, receivedAt:data?.received_at ?? null, regions:regions.map(region => region.name),
    slotMinutes:DISCOVERY_SLOT_MINUTES, searchesPerSlot:DISCOVERY_SEARCHES_PER_SLOT,
    discoveryEligible:configured && feedAvailable && nearby.remaining > 0};
}
