import assert from 'node:assert/strict';
import test from 'node:test';
import {GOOGLE_SKUS, pacificMonth, summarizeGoogleUsage} from '../lib/google-sku-budget.js';
import {authenticateUsageReport, signUsageReport, validateUsageReport} from '../lib/google-usage-report.js';

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
