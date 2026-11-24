// Structural validation only; never request ticket pages during map rendering.
const rejectedEventIds = new Set(['Z7r9jZ1A7Pv4y']);
export function ticketDestination(url) {
  try { let u = new URL(url); if (u.hostname === 'ticketmaster.evyy.net') u = new URL(u.searchParams.get('u')); if (u.protocol !== 'https:' || u.username || u.password || u.port || !['www.ticketmaster.com','ticketmaster.com','www.livenation.com','livenation.com'].includes(u.hostname)) return null; if (!/\/event\/[a-z0-9_-]+(?:\/|$)/i.test(u.pathname)) return null; u.search=''; u.hash=''; return u.href; } catch { return null; }
}
export function ticketStatus(e) { const v=e.ticket_verification; return v?.url === ticketDestination(e.url) && Date.parse(v.expires_at)>Date.now() ? v.status : 'unknown'; }
export function ticketQuality(url) {
  try {
    let u=new URL(url);
    if(u.hostname==='ticketmaster.evyy.net') u=new URL(u.searchParams.get('u'));
    if(u.protocol!=='https:' || u.username || u.password || u.port) return 0;
    if(rejectedEventIds.has(u.pathname.split('/').filter(Boolean).pop())) return 0;
    const hosts=['www.ticketmaster.com','ticketmaster.com','www.ticketmaster.ca','ticketmaster.ca','www.livenation.com','livenation.com','www.ticketweb.com','ticketweb.com','www.ticketweb.ca','ticketweb.ca','www.universe.com','universe.com','www.etix.com','www.axs.com','seatgeek.com','www.gofevo.com'];
    return hosts.includes(u.hostname) && u.pathname.length>1 ? 2 : 0;
  } catch { return 0; }
}
export function preferredTicketRecord(a,b) {
  const score = e => (ticketStatus(e)==='working'?1000:ticketStatus(e)==='dead'?-1000:0) + ticketQuality(e.url)*100 + (e.price ? 10 : 0) + (e.address ? 4 : 0) + ((e.img || e.image_url) ? 1 : 0);
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
    const working = group.filter(e => ticketStatus(e)==='working');
    return working.length ? group.filter(e=>ticketStatus(e)!=='dead') : group;
  });
}
