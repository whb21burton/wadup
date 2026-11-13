// Extract public schema.org Event JSON-LD without a paid AI request.
// Only explicit dates with times are publishable; unknown times require review.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d/;
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...nodes(value['@graph'] || []), ...nodes(value.itemListElement || [])];
}
function eventType(type) {
  const t = String(type || '').toLowerCase();
  if (/music|concert/.test(t)) return 'live_music';
  if (/comedy/.test(t)) return 'comedy';
  return 'other';
}
export function extractStructuredEvents(html, now = new Date()) {
  const found = [];
  const blocks = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of blocks) {
    let json;
    try { json = JSON.parse(match[1].trim()); } catch { continue; }
    for (const item of nodes(json)) {
      const types = [item['@type']].flat().map(String);
      if (!types.some(t => /Event$/i.test(t))) continue;
      const start = item.startDate;
      if (typeof start !== 'string' || !DATE_TIME.test(start)) continue;
      const instant = new Date(start);
      if (!Number.isFinite(instant.getTime()) || instant <= now) continue;
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) continue;
      found.push({
        title: name.slice(0, 250),
        start_time: start,
        event_type: eventType(types.join(' ')),
        description: typeof item.description === 'string' ? item.description.slice(0, 2000) : '',
        performer: typeof item.performer?.name === 'string' ? item.performer.name : null,
      });
    }
  }
  return [...new Map(found.map(e => [e.title.toLowerCase() + '|' + e.start_time, e])).values()];
}
