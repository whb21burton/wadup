// Publish a normalized report from an already-approved export pipeline.
// The script reads stdin or a file and makes no network request unless --send is supplied.
import {readFile} from 'node:fs/promises';
import {stdin} from 'node:process';
import {authenticateUsageReport, signUsageReport, validateUsageReport} from '../lib/google-usage-report.js';

const [file, mode] = process.argv.slice(2);
const account = process.env.GOOGLE_USAGE_BILLING_ACCOUNT;
try {
  let raw;
  if (file === '-') {
    const chunks=[];
    let bytes=0;
    for await (const chunk of stdin) {
      bytes+=chunk.length;
      if (bytes>16384) throw Error('Report exceeds the size limit');
      chunks.push(chunk);
    }
    raw=Buffer.concat(chunks);
  } else raw=await readFile(file);
  if (raw.length>16384 || !validateUsageReport(JSON.parse(raw),account)) throw Error('Invalid or stale account-wide report');
  if (mode !== '--send') {
    console.log('Billing report validated locally');
  } else {
    const secret = process.env.GOOGLE_USAGE_FEED_SECRET;
    const url = new URL(process.env.GOOGLE_USAGE_RECEIVER);
    if (!secret || secret.length<32 || url.protocol!=='https:' || url.username || url.password || url.port ||
        url.pathname!=='/api/cron/import-google-usage' || url.search || url.hash) throw Error('Receiver configuration is invalid');
    const timestamp=String(Date.now());
    const signature=signUsageReport(secret,timestamp,raw);
    if (!authenticateUsageReport(secret,timestamp,signature,raw)) throw Error('Signature generation failed');
    const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{
      'Content-Type':'application/json','X-Wadup-Timestamp':timestamp,'X-Wadup-Signature':signature,
    },body:raw});
    if (response.status!==202) throw Error(`Receiver returned HTTP ${response.status}`);
    console.log('Billing report accepted');
  }
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Report is not valid JSON' : error.message);
  process.exitCode=1;
}
