// Read-only Google Cloud API usage endpoint. No persistent Google credentials.
// Protected by ADMIN_SYNC_PASSWORD; production Vercel OIDC token required.
const PROJECT_ID = 'project-24f94cff-cf36-4269-940';
const PROJECT_NUMBER = '290972687324';
const POOL = 'wadup-vercel';
const PROVIDER = 'wadup-oidc';
const SERVICE_ACCOUNT = 'wadup-usage-monitor@' + PROJECT_ID + '.iam.gserviceaccount.com';
const AUDIENCE = '//iam.googleapis.com/projects/' + PROJECT_NUMBER +
  '/locations/global/workloadIdentityPools/' + POOL + '/providers/' + PROVIDER;

async function googlePost(url, body, bearer) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error_description || 'Google authentication failed');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  if (!process.env.ADMIN_SYNC_PASSWORD ||
      req.headers.authorization !== 'Bearer ' + process.env.ADMIN_SYNC_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const oidc = req.headers['x-vercel-oidc-token'];
  if (typeof oidc !== 'string' || !oidc) {
    return res.status(503).json({ error: 'No Vercel OIDC token available on this function request' });
  }
  try {
    const sts = await googlePost('https://sts.googleapis.com/v1/token', {
      audience: AUDIENCE,
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken: oidc,
    });
    const impersonated = await googlePost(
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
        encodeURIComponent(SERVICE_ACCOUNT) + ':generateAccessToken',
      { scope: ['https://www.googleapis.com/auth/monitoring.read'], lifetime: '600s' },
      sts.access_token,
    );
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400000);
    const filter = 'metric.type="serviceruntime.googleapis.com/api/request_count"';
    const params = new URLSearchParams({
      filter,
      'interval.startTime': start.toISOString(),
      'interval.endTime': end.toISOString(),
      'aggregation.alignmentPeriod': '86400s',
      'aggregation.perSeriesAligner': 'ALIGN_SUM',
      pageSize: '1000',
    });
    const response = await fetch(
      'https://monitoring.googleapis.com/v3/projects/' + PROJECT_ID + '/timeSeries?' + params,
      { headers: { Authorization: 'Bearer ' + impersonated.accessToken } },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({
        error: 'Cloud Monitoring query failed',
        status: response.status,
        detail: data.error?.message || 'Unknown monitoring error',
      });
    }
    return res.status(200).json({
      project: PROJECT_ID, period_start: start.toISOString(), period_end: end.toISOString(),
      metric: filter, series: data.timeSeries || [],
      nextPageToken: data.nextPageToken || null,
      note: 'Request counts, not billing charges. May include multiple response-code series.',
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Google OIDC authentication failed',
      status: error.status || 502,
      detail: error.message,
    });
  }
}
