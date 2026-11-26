// Structural validation only; never request ticket pages during map rendering.
const rejectedEventIds = new Set(['Z7r9jZ1A7Pv4y','Z7r9jZ1A70gug']);
const ticketHosts = new Set(['www.ticketmaster.com','ticketmaster.com','www.ticketmaster.ca','ticketmaster.ca','www.livenation.com','livenation.com','www.ticketweb.com','ticketweb.com','www.ticketweb.ca','ticketweb.ca','www.universe.com','universe.com','www.etix.com','www.axs.com','seatgeek.com','www.gofevo.com']);
export function ticketDestination(url) {
  try {
    let u=new URL(url);
    if(u.hostname==='ticketmaster.evyy.net')u=new URL(u.searchParams.get('u'));
    if(u.protocol!=='https:'||u.username||u.password||u.port||!ticketHosts.has(u.hostname)||u.pathname.length<=1)return null;
    if(/^(www\.)?(ticketmaster|livenation)\./.test(u.hostname)&&!/\/event\/[a-z0-9_-]+(?:\/|$)/i.test(u.pathname))return null;
    // Preserve provider-specific query parameters; some identify the performance.
    u.hash='';
    return u.href;
  }catch{return null;}
}
export function ticketStatus(e) { if (rejectedEventIds.has(String(e.tm_id||e.id||'').replace(/^tm_/,''))) return 'dead'; const v=e.ticket_verification; return v?.url === ticketDestination(e.url) && Date.parse(v.expires_at)>Date.now() ? v.status : 'unknown'; }
export function ticketQuality(url) {
 const destination=ticketDestination(url);
 if(!destination)return 0;
 return rejectedEventIds.has(new URL(destination).pathname.split('/').filter(Boolean).pop())?0:2;
}
export function affiliateTicketUrl(ticketUrl, account) {
 const destination=ticketDestination(ticketUrl);
 if(!destination||!ticketQuality(destination))return null;
 const provider=new URL(destination);
 if(!['www.ticketmaster.com','ticketmaster.com','www.livenation.com','livenation.com'].includes(provider.hostname)) {
  return new URL(ticketUrl).hostname==='ticketmaster.evyy.net' ? ticketUrl : destination;
 }
 return `https://ticketmaster.evyy.net/c/${encodeURIComponent(account)}/264167/4272?u=${encodeURIComponent(destination)}`;
}
export function officialTicketLink(officialUrl, venueWebsite, affiliateAccount) {
 try {
  const url=new URL(officialUrl);
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  if(ticketDestination(url.href)&&!ticketQuality(url.href))return null;
  if(url.href===venueWebsite||url.pathname==='/')return null;
  let label='View official event';
  if(url.hostname==='foxtheatre.evenue.net'&&/SEGet(?:Group|Event)List/i.test(url.pathname))label='Choose a performance on the official site';
  else if(ticketDestination(url.href)||['eventim.us','www.eventim.us'].includes(url.hostname)||
    (url.hostname==='my.alliancetheatre.org'&&/^\/\d+\/\d+\/?$/.test(url.pathname))||
    (url.hostname==='foxtheatre.evenue.net'&&/^\/events\/[^/]+\/?$/.test(url.pathname)))label='Get Tickets';
  return {url:affiliateTicketUrl(url.href,affiliateAccount)||url.href,label};
 }catch{return null;}
}
export function preferredTicketRecord(a,b) {
  const score = e => (ticketStatus(e)==='working'?1000:ticketStatus(e)==='dead'?-1000:0) + ticketQuality(e.url)*100 + (e.price ? 10 : 0) + (e.address ? 4 : 0) + ((e.img || e.image_url) ? 1 : 0);
  return score(b)>score(a) ? b : a;
}
export function suppressTicketDuplicates(rows) {
  const groups = new Map();
  const knownReplacement = new Map([['Z7r9jZ1A7Pv4y','rZ7HnEZ1Afr3OS']]);
  const ids = new Set(rows.map(e=>String(e.tm_id||e.id||'').replace(/^tm_/,'')));
  const norm = s => String(s||'').normalize('NFKC').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  for (const e of rows) {
    const replacement=knownReplacement.get(String(e.tm_id||e.id||'').replace(/^tm_/,''));
    if(replacement && ids.has(replacement)) continue;
    const date=e.dateStr||e.date_str, time=e.timeStr||e.time_str;
    const key = date && time && e.city && e.address ? [norm(e.name),norm(e.city),norm(e.state),norm(e.address).replace(/\bavenue\b/g,'ave').replace(/\bstreet\b/g,'st').replace(/\broad\b/g,'rd').replace(/\bboulevard\b/g,'blvd'),date,time.slice(0,5)].join('|') : 'id:'+ (e.id||e.tm_id);
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

// Explicitly reported broken destinations; retain the event and offer a venue fallback.
export function ticketFallback(e) {
  const id=String(e.tm_id||e.id||'').replace(/^tm_/,'');
  if(id==='Z7r9jZ1A70gug') return {url:'https://www.alliancetheatre.org/',label:'Check with Alliance Theatre'};
  return null;
}
