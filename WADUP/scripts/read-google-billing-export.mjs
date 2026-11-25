// Optional producer for an already-enabled Standard Cloud Billing export.
// Running this script without --query performs no Google API operation.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {GOOGLE_SKUS, pacificMonth} from '../lib/google-sku-budget.js';
import {validateUsageReport} from '../lib/google-usage-report.js';

const now = new Date();
const month = pacificMonth(now);
const coveredThrough = new Date(now.getTime()-48*3600000).toISOString();
const account = process.env.GOOGLE_USAGE_BILLING_ACCOUNT;
const table = process.env.GOOGLE_USAGE_EXPORT_TABLE;
const quotaProject = process.env.GOOGLE_USAGE_QUERY_PROJECT;
const maxBytes = process.env.GOOGLE_USAGE_QUERY_MAX_BYTES;

try {
  if (!process.argv.includes('--query')) {
    console.log('No query submitted. This producer requires an approved existing export and --query.');
  } else {
    if (process.env.GOOGLE_USAGE_QUERY_APPROVED !== 'true' ||
        !/^[A-Za-z0-9-]+\.[A-Za-z0-9_]+\.gcp_billing_export_v1_[A-Za-z0-9_]+$/.test(table || '') ||
        !/^[A-Za-z0-9-]+$/.test(quotaProject || '') || !/^[A-Za-z0-9-]+$/.test(account || '') ||
        !/^[1-9]\d{0,11}$/.test(maxBytes || '')) throw Error('Approved and bounded billing query configuration is required');
    if (pacificMonth(new Date(coveredThrough)) !== month) throw Error('New billing month is within the reporting-delay window');
    const skuIds=GOOGLE_SKUS.map(([id])=>`'${id}'`).join(',');
    const sql=`WITH account_rows AS (
      SELECT sku.id AS sku_id, usage.amount AS amount, LOWER(usage.unit) AS unit, usage_start_time, export_time
      FROM \`${table}\`
      WHERE billing_account_id=@account
        AND usage_start_time >= TIMESTAMP(CONCAT(@month,'-01 00:00:00'),'America/Los_Angeles')
    ), totals AS (
      SELECT sku_id, SUM(amount) AS amount,
        COUNTIF(unit IS NULL OR unit NOT IN ('count','request','requests','event','events')) AS incompatible_units
      FROM account_rows WHERE usage_start_time < TIMESTAMP(@cutoff) AND sku_id IN (${skuIds}) GROUP BY sku_id
    )
    SELECT id, COALESCE(amount,0) AS amount, COALESCE(incompatible_units,0) AS incompatible_units,
      (SELECT MAX(export_time) FROM account_rows) AS latest_export
    FROM UNNEST([${skuIds}]) AS id LEFT JOIN totals ON id=sku_id`;
    const result=spawnSync('bq',['--format=json',`--project_id=${quotaProject}`,'query','--use_legacy_sql=false',
      `--maximum_bytes_billed=${maxBytes}`,`--parameter=account:STRING:${account}`,
      `--parameter=month:STRING:${month}`,`--parameter=cutoff:STRING:${coveredThrough}`],
    {input:sql,encoding:'utf8',timeout:60000,maxBuffer:131072,windowsHide:true});
    if (result.error || result.status!==0) throw Error('The bounded export query failed');
    const rows=JSON.parse(result.stdout);
    const latestExport=Date.parse(rows[0]?.latest_export);
    if (!Number.isFinite(latestExport) || now.getTime()-latestExport>24*3600000 ||
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
