import assert from 'node:assert/strict';
import test from 'node:test';
import {GOOGLE_SKUS, pacificMonth, summarizeGoogleUsage} from '../lib/google-sku-budget.js';
import {authenticateUsageReport, signUsageReport, validateUsageReport} from '../lib/google-usage-report.js';
import {discoveryRegions, tileDistance} from '../lib/google-discovery-plan.js';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const peerKey='fixture-secret-not-used-outside-tests-0000';
const now=new Date('2026-11-26T03:00:00Z');

test('signed reports fail closed on tampering, wrong key, stale envelope and malformed signature',()=>{
  const stamp=String(now.getTime());
  const body=Buffer.from('{"fixture":1}');
  const signature=signUsageReport(peerKey,stamp,body);
  assert.equal(authenticateUsageReport(peerKey,stamp,signature,body,now.getTime()),true);
  assert.equal(authenticateUsageReport(peerKey,stamp,signature,Buffer.from('{"fixture":2}'),now.getTime()),false);
  assert.equal(authenticateUsageReport(peerKey,stamp,signature,body,now.getTime()+301000),false);
  assert.equal(authenticateUsageReport(peerKey+'x',stamp,signature,body,now.getTime()),false);
  assert.equal(authenticateUsageReport(peerKey,stamp,'ffff',body,now.getTime()),false);
});

test('billing import requires the configured account, all SKU counts and a recent Pacific-month watermark',()=>{
  assert.equal(pacificMonth(new Date('2026-12-01T06:30:00Z')),'2026-11');
  const units=Object.fromEntries(GOOGLE_SKUS.map(([id])=>[id,0]));
  const report={billingAccount:'fixture',scope:'billing-account',batchId:'this-is-a-fixture',month:'2026-11',coveredThrough:'2026-11-24T03:00:00Z',units};
  assert.equal(validateUsageReport(report,'fixture',now).units['99F9-A108-83A6'],0);
  for(const change of [{scope:'project'},{month:'2026-12'},{coveredThrough:'2026-11-20T03:00:00Z'},{units:{}},{units:{...units,'99F9-A108-83A6':-1}}]) {
    assert.equal(validateUsageReport({...report,...change},'fixture',now),null);
  }
  assert.equal(validateUsageReport(report,'another-account',now),null);
});

test('remaining balance accounts for the SKU-specific reserve and outstanding requests',()=>{
  const coveredThrough='2026-11-24T03:00:00Z';
  const nearby='99F9-A108-83A6', maps='FAF4-3B2D-51B2', photo='DCD1-FE97-8C71';
  const data=summarizeGoogleUsage({[nearby]:{units:4498,coveredThrough},[photo]:{units:999,coveredThrough}}, {[nearby]:2,[photo]:2}, now);
  assert.equal(data.find(row=>row.id===nearby).remaining,0);
  assert.equal(data.find(row=>row.id===photo).estimatedUsd,0.007);
  assert.equal(data.find(row=>row.id===maps).remaining,null);
});

test('discovery uses a 15-minute schedule and city centers in the configured order', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.crons.find(cron => cron.path.endsWith('/restaurant-coverage')).schedule, '*/15 * * * *');
  const cities = [{ name: 'Chattanooga', lat: 35.0456, lng: -85.3096 }, { name: 'Atlanta', lat: 33.749, lng: -84.388 }];
  assert.deepEqual(discoveryRegions(JSON.stringify(cities)), cities);
  assert.deepEqual(discoveryRegions(undefined, 'Chattanooga'), cities.slice(0, 1));
  assert.deepEqual(discoveryRegions(JSON.stringify([cities[0], cities[0]]), 'Chattanooga'), []);
  assert.deepEqual(discoveryRegions('[{"name":"Atlanta","lat":99,"lng":-84}]'), []);
  assert.equal(tileDistance(cities[1], cities[1]), 0);
  assert.ok(tileDistance(cities[0], cities[1]) > 0);
});

test('BigQuery preflight uses metadata and dry run only, enforcing location and byte limits', () => {
  const fixture = `
    import childProcess from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    childProcess.spawnSync = (exe,args,options) => {
      if(exe !== 'bq' || !args.includes('--location=US')) throw Error('Unexpected command');
      if(args.includes('show')) return {status:0,stdout:JSON.stringify({
        type:'TABLE',location:process.env.FIXTURE_LOCATION,numBytes:'1024'
      })};
      if(!args.includes('--dry_run') || !args.includes('--maximum_bytes_billed=1073741824') ||
          !options.input.includes('usage_end_time <= TIMESTAMP(@cutoff)')) throw Error('Query lacks preflight safeguards');
      return {status:0,stdout:'Query will process '+process.env.FIXTURE_BYTES+' bytes',stderr:''};
    };
    syncBuiltinESMExports();
  `;
  const script=fileURLToPath(new URL('../scripts/read-google-billing-export.mjs',import.meta.url));
  const check=(location,bytes)=>spawnSync(process.execPath,
    ['--import','data:text/javascript;base64,'+Buffer.from(fixture).toString('base64'),script,'--preflight'],
    {encoding:'utf8',env:{...process.env,GOOGLE_USAGE_BILLING_ACCOUNT:'FIXTURE-ABC',
      GOOGLE_USAGE_EXPORT_TABLE:'wadup-fixture.wadup_billing.gcp_billing_export_v1_FIXTURE_ABC',
      GOOGLE_USAGE_QUERY_PROJECT:'wadup-fixture',GOOGLE_USAGE_QUERY_MAX_BYTES:'1073741824',
      FIXTURE_LOCATION:location,FIXTURE_BYTES:bytes}});
  assert.equal(JSON.parse(check('US','1024').stdout).estimatedQueryBytes,1024);
  assert.equal(check('EU','1024').status,1);
  assert.equal(check('US','1073741825').status,1);
  assert.equal(check('US','0').status,1);
});
