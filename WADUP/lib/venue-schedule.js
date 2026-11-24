// Only explicit structured performances are imported; never invent showtimes.
export function parseVenueSchedule(html, venue) {
 const rows=[];
 function visit(node) {
  if(Array.isArray(node)){node.forEach(visit);return;}
  if(!node||typeof node!=='object')return;
  const types=[node['@type']].flat();
  if(types.some(t=>typeof t==='string'&&/Event$/.test(t)) && typeof node.name==='string' && typeof node.startDate==='string') {
   const m=node.startDate.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
   const locationName=(typeof node.location==='string'?node.location:node.location?.name)?.trim().toLowerCase();
   const matchingLocation=!venue.sharedSchedule || venue.aliases.some(alias=>alias.toLowerCase()===locationName);
   if(m && matchingLocation && !String(node.eventStatus||'').endsWith('EventCancelled')) {
    let officialUrl=venue.website;
    try {const u=new URL(node.url||venue.website,venue.website);if(u.protocol==='https:'&&u.hostname===new URL(venue.website).hostname)officialUrl=u.href;}catch{}
    rows.push({venueId:venue.id,name:node.name,dateStr:m[1],timeStr:m[2]+':00',officialUrl,source:'official-venue'});
   }
  }
  Object.values(node).forEach(visit);
 }
 for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{visit(JSON.parse(m[1]));}catch{}
 }
 const key=e=>[e.venueId,e.name.toLowerCase().trim(),e.dateStr,e.timeStr].join('|');
 return [...new Map(rows.map(e=>[key(e),e])).values()];
}
export function matchPerformance(official, source) {
 const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 return official.venueId===source.venueId && norm(official.name)===norm(source.name) && official.dateStr===source.dateStr && official.timeStr.slice(0,5)===String(source.timeStr||'').slice(0,5);
}

export function parseSignalSchedule(html, venue) {
 const rows=[];
 for(const [, article] of html.matchAll(/<article\b[^>]*class="[^"]*\beventlist-event\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)) {
  const event=article.match(/<a href="(\/tickets\/[\w%-]+)" class="eventlist-title-link">([^<]+)<\/a>/i);
  const start=article.match(/<time class="event-time-localized-start" datetime="(\d{4}-\d{2}-\d{2})">\s*(1[0-2]|[1-9]):([0-5]\d)\s*([AP]M)\s*<\/time>/i);
  if(!event || !start || /\b(?:canceled|cancelled|postponed)\b/i.test(event[2]))continue;
  const [,dateStr,hour,minute,period]=start;
  const hour24=Number(hour)%12+(period.toUpperCase()==='PM'?12:0);
  const name=event[2].replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim();
  rows.push({venueId:venue.id,name,dateStr,timeStr:`${String(hour24).padStart(2,'0')}:${minute}:00`,officialUrl:new URL(event[1],venue.website).href,source:'official-venue'});
 }
 return rows;
}
