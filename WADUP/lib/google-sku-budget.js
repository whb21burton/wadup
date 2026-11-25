// Global pay-as-you-go limits. All estimates use the first paid volume tier.
export const GOOGLE_SKUS = [
  ['FAF4-3B2D-51B2', 'Dynamic Maps', 10000, 7],
  ['BAC8-4E68-E261', 'Geocoding', 10000, 5],
  ['99F9-A108-83A6', 'Nearby Search Pro', 5000, 32],
  ['772E-9975-BE34', 'Nearby Search Enterprise', 1000, 35],
  ['4FDA-34B1-A910', 'Text Search Pro', 5000, 32],
  ['E967-44BC-B44D', 'Text Search Enterprise', 1000, 35],
  ['6E05-E1C3-8D85', 'Place Details Essentials', 10000, 5],
  ['4ED6-464A-2AFC', 'Place Details Pro', 5000, 17],
  ['2D9A-3DE0-3766', 'Place Details Enterprise', 1000, 20],
  ['EB23-5ECC-0EF7', 'Place Details Enterprise + Atmosphere', 1000, 25],
  ['DCD1-FE97-8C71', 'Place Details Photos', 1000, 7],
];

export function pacificMonth(date) {
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Los_Angeles'}).format(date).slice(0, 7);
}

export function summarizeGoogleUsage(reports, pendingBySku, now = new Date()) {
  return GOOGLE_SKUS.map(([id, name, freeCap, price]) => {
    const report = reports[id];
    const age = now.getTime() - Date.parse(report?.coveredThrough);
    const fresh = Number.isFinite(age) && age >= 0 && age <= 72 * 3600000;
    const reserve = Math.ceil(freeCap * 0.1);
    const pending = pendingBySku[id] ?? null;
    const usage = report ? report.units + (pending ?? 0) : null;
    return {id, name, freeCap, reserve, reported:report?.units ?? null, pending, coveredThrough:report?.coveredThrough ?? null,
      fresh, remaining:!fresh || usage == null ? null : Math.max(0, freeCap - reserve - usage),
      estimatedUsd:usage == null ? null : Math.max(0, usage - freeCap) * price / 1000};
  });
}
