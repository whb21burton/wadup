import {authenticateUsageReport, validateUsageReport} from '../../../lib/google-usage-report';
import {loadCronDatabase} from '../../../lib/cron-auth';

export const config = {api:{bodyParser:false}};

export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).end();
  const secret=process.env.GOOGLE_USAGE_FEED_SECRET;
  const account=process.env.GOOGLE_USAGE_BILLING_ACCOUNT;
  if (!secret || !account) return res.status(503).json({error:'Billing feed disabled'});
  const chunks=[];
  let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>16384) return res.status(413).end();
    chunks.push(chunk);
  }
  const raw=Buffer.concat(chunks);
  if (!authenticateUsageReport(secret,req.headers['x-wadup-timestamp'],req.headers['x-wadup-signature'],raw)) return res.status(401).end();
  let report;
  try { report=validateUsageReport(JSON.parse(raw),account); } catch { return res.status(400).end(); }
  if (!report) return res.status(422).json({error:'Invalid billing report'});
  const db=await loadCronDatabase();
  if (!db) return res.status(503).json({error:'Billing storage unavailable'});
  const {error}=await db.from('google_usage_reports').upsert(report,{onConflict:'batch_id',ignoreDuplicates:true});
  if (error) return res.status(503).json({error:'Billing report could not be stored'});
  return res.status(202).end();
}
