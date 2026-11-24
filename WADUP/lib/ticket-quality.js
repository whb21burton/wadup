// Structural validation only; never request ticket pages during map rendering.
export function ticketQuality(url) {
  try {
    let u = new URL(url);
    if (u.hostname === 'ticketmaster.evyy.net') u = new URL(u.searchParams.get('u'));
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
    const date=e.dateStr||e.date_str, time=e.timeStr||e.time_str;
    const key = date && time && e.city ? [norm(e.name),norm(e.city),norm(e.state),date,time.slice(0,5)].join('|') : 'id:'+ (e.id||e.tm_id);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(e);
  }
  return [...groups.values()].flatMap(group => {
    const valid=group.filter(e=>ticketQuality(e.url)>0);
    // Only suppress ambiguous distant listings when a single strong
    // purchase candidate exists. Preserve distinct valid venues.
    const priced=valid.filter(e=>e.price);
    if (valid.length===1) return valid;
    if (priced.length===1 && group.length>1) return group.filter(e=>e===priced[0] || (ticketQuality(e.url)>0 && e.price));
    return group;
  });
}
