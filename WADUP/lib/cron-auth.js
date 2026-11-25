export function canRunLegacyCron(headers, env = process.env) {
  return Boolean(
    (env.CRON_SECRET && headers.authorization === `Bearer ${env.CRON_SECRET}`) ||
    (env.ADMIN_SYNC_PASSWORD && headers['x-admin-password'] === env.ADMIN_SYNC_PASSWORD)
  );
}
