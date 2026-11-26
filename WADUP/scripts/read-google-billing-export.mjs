// Optional producer for an already-enabled Standard Cloud Billing export.
// --preflight reads metadata and dry-runs SQL. --query submits a bounded data query.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {GOOGLE_SKUS, pacificMonth} from '../lib/google-sku-budget.js';
import {validateUsageReport} from '../lib/google-usage-report.js';

const now = new Date();
const month = pacificMonth(now);
const hour = 3600000;
const coveredThrough = new Date(Math.floor(now.getTime()/hour)*hour-48*hour).toISOString();
const account = process.env.GOOGLE_USAGE_BILLING_ACCOUNT;
const table = process.env.GOOGLE_USAGE_EXPORT_TABLE;
const quotaProject = process.env.GOOGLE_USAGE_QUERY_PROJECT;
const maxBytes = process.env.GOOGLE_USAGE_QUERY_MAX_BYTES || String(2**30);
const query = process.argv.includes('--query');
const preflight = process.argv.includes('--preflight');

function bq(args, input) {
  const result = spawnSync('bq',['--location=US','--format=json',`--project_id=${quotaProject}`,...args],
    {input,encoding:'utf8',timeout:60000,maxBuffer:131072,windowsHide:true});
  if (result.error || result.status!==0) throw Error('BigQuery access, export table, or query limit check failed');
  return result;
}

try {
  if (!query && !preflight) {
    console.log('No query submitted. This producer requires an approved existing export and --query.');
  } else {
    if ((query && (preflight || process.env.GOOGLE_USAGE_QUERY_APPROVED !== 'true')) ||
        !/^[a-z][a-z0-9-]+\.wadup_billing\.gcp_billing_export_v1_[A-Za-z0-9_]+$/.test(table || '') ||
        !/^[A-Za-z0-9-]+$/.test(quotaProject || '') || !/^[A-Za-z0-9-]+$/.test(account || '') ||
        !/^[1-9]\d{0,9}$/.test(maxBytes) || Number(maxBytes)>2**30 ||
        !table.endsWith(`_${account.replaceAll('-','_')}`)) throw Error('Approved and bounded billing query configuration is required');
    if (query && pacificMonth(new Date(coveredThrough)) !== month) throw Error('New billing month is within the reporting-delay window');
    const [project, dataset, exportTable] = table.split('.');
    const metadata = JSON.parse(bq(['show',`${project}:${dataset}.${exportTable}`]).stdout);
    const bytes = Number(metadata.numTotalLogicalBytes ?? metadata.numBytes);
    if (metadata.location !== 'US' || metadata.type !== 'TABLE' ||
        !Number.isSafeInteger(bytes) || bytes < 0 || bytes >= 8*2**30 ||
        metadata.expirationTime || metadata.timePartitioning?.expirationMs) {
      throw Error('Export metadata has an unexpected region, storage size, or expiration policy');
    }
    const skuIds=GOOGLE_SKUS.map(([id])=>`'${id}'`).join(',');
    const sql=`WITH account_rows AS (
      SELECT sku.id AS sku_id, usage.amount AS amount, LOWER(usage.unit) AS unit, usage_end_time, export_time
      FROM \`${table}\`
      WHERE billing_account_id=@account
        AND usage_start_time >= TIMESTAMP(CONCAT(@month,'-01 00:00:00'),'America/Los_Angeles')
    ), totals AS (
      SELECT sku_id, SUM(amount) AS amount,
        COUNTIF(unit IS NULL OR unit NOT IN ('count','request','requests','event','events')) AS incompatible_units
      FROM account_rows WHERE usage_end_time <= TIMESTAMP(@cutoff) AND sku_id IN (${skuIds}) GROUP BY sku_id
    )
    SELECT id, COALESCE(amount,0) AS amount, COALESCE(incompatible_units,0) AS incompatible_units,
      (SELECT MAX(export_time) FROM account_rows) AS latest_export,
      (SELECT MAX(usage_end_time) FROM account_rows) AS latest_usage
    FROM UNNEST([${skuIds}]) AS id LEFT JOIN totals ON id=sku_id`;
    const args=['query','--use_legacy_sql=false',
      `--maximum_bytes_billed=${maxBytes}`,`--parameter=account:STRING:${account}`,
      `--parameter=month:STRING:${month}`,`--parameter=cutoff:STRING:${coveredThrough}`];
    if (preflight) {
      const result = bq([...args,'--dry_run'],sql);
      const estimate = Number((result.stdout + result.stderr).match(/process ([0-9,]+) bytes/i)?.[1]?.replaceAll(',',''));
      if (!Number.isSafeInteger(estimate) || estimate <= 0 || estimate > Number(maxBytes))
        throw Error('Dry run did not verify a nonempty export and a scan within budget');
      console.log(JSON.stringify({location:'US',tableLogicalBytes:bytes,estimatedQueryBytes:estimate,maxBytesBilled:Number(maxBytes)}));
      process.exit(0);
    }
    const result=bq(args,sql);
    const rows=JSON.parse(result.stdout);
    const latestExport=Date.parse(rows[0]?.latest_export);
    const latestUsage=Date.parse(rows[0]?.latest_usage);
    if (!Number.isFinite(latestExport) || latestExport > now.getTime() || now.getTime()-latestExport>24*hour ||
        !Number.isFinite(latestUsage) || latestUsage<Date.parse(coveredThrough) || latestUsage>now.getTime()+hour ||
        rows.some(row=>Number(row.incompatible_units)!==0 || !Number.isFinite(Number(row.amount)) || Number(row.amount)<0))
      throw Error('Export is stale or billing event units cannot be verified');
    const units=Object.fromEntries(rows.map(row=>[row.id,Math.ceil(Number(row.amount))]));
    const batchId=createHash('sha256').update(JSON.stringify({month,coveredThrough,units})).digest('hex');
    const report={batchId,scope:'billing-account',billingAccount:account,month,coveredThrough,units};
    if (!validateUsageReport(report,account,now)) throw Error('Export did not contain a valid complete SKU report');
    process.stdout.write(JSON.stringify(report));
  }
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Invalid billing export response' : error.message);
  process.exitCode=1;
}
