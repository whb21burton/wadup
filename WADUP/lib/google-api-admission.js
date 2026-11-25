import {loadCronDatabase} from './cron-auth';

export async function reserveGoogleApiUse(sku) {
  if (process.env.GOOGLE_METERED_REQUESTS_VERIFIED !== 'true') return false;
  const db=await loadCronDatabase();
  if (!db) return false;
  const {data,error}=await db.rpc('reserve_google_api_use',{p_sku:sku});
  return !error && data===true;
}
