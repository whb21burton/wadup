import {createHmac, timingSafeEqual} from 'node:crypto';
import {GOOGLE_SKUS, pacificMonth} from './google-sku-budget.js';

export function signUsageReport(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}\n`).update(body).digest('hex');
}

export function authenticateUsageReport(secret, timestamp, signature, body, now = Date.now()) {
  if (!secret || secret.length < 32 || typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp)) > 300000 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signUsageReport(secret, timestamp, body), 'hex'));
}

export function validateUsageReport(report, billingAccount, now = new Date()) {
  if (!report || !billingAccount || report.billingAccount !== billingAccount || report.scope !== 'billing-account' ||
      typeof report.batchId !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(report.batchId)) return null;
  const coveredThrough = Date.parse(report.coveredThrough);
  if (!Number.isFinite(coveredThrough) || coveredThrough > now.getTime() || now.getTime() - coveredThrough > 72 * 3600000 ||
      report.month !== pacificMonth(now) || report.month !== pacificMonth(new Date(coveredThrough))) return null;
  const usage = report.units;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage) || Object.keys(usage).length !== GOOGLE_SKUS.length ||
      GOOGLE_SKUS.some(([id]) => !Number.isSafeInteger(usage[id]) || usage[id] < 0)) return null;
  return {batch_id:report.batchId, billing_month:report.month, covered_through:new Date(coveredThrough).toISOString(), units:usage};
}
