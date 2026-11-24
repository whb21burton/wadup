// Structural validation only; never request ticket pages during map rendering.
const rejectedEventIds = new Set(['Z7r9jZ1A7Pv4y']);
export function ticketQuality(url) {
  try {
    let u = new URL(url);
    if (u.hostname === 'ticketmaster.evyy.net') u = new URL(u.searchParams.get('u'));
    if (rejectedEventIds.has(u.pathname.split('/').filter(Boolean).pop())) return 0;
    if (u.protocol !== 'https:') return 0;
    if (!/(^|\.)(ticketmaster\.com|livenation\.com)$/.test(u.hostname)) return 0;
    return /\/event\/[a-z0-9_-]+(?:\/|$)/i.test(u.pathname) ? 2 : 0;
  } catch { return 0; }
}
export function preferredTicketRecord(a,b) {
  const score = e => ticketQuality(e.url)*100 + (e.price ? 10 : 0) + (e.address ? 4 : 0) + ((e.img || e.image_url) ? 1 : 0);
  return score(b)>score(a) ? b : a;
}
export function suppressTicketDuplicates(rows) {
  const groups = new Map();
  const norm = s => String(s||'').normalize('NFKC').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  for (const e of rows) {
    if (rejectedEventIds.has(String(e.tm_id || e.id || '').replace(/^tm_/,''))) continue;
    try { let u = new URL(e.url); if (u.hostname === 'ticketmaster.evyy.net') u = new URL(u.searchParams.get('u')); if (rejectedEventIds.has(u.pathname.split('/').filter(Boolean).pop())) continue; } catch {}
    const date=e.dateStr||e.date_str, time=e.timeStr||e.time_str;
    const key = date && time && e.city ? [norm(e.name),norm(e.city),norm(e.state),date,time.slice(0,5)].join('|') : 'id:'+ (e.id||e.tm_id);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(e);
  }
  return [...groups.values()].flatMap(group => {
    // A plausible URL is not proof that a purchase page works.
    // Preserve ambiguous records rather than discard a working event.
    return group;
  });
}
