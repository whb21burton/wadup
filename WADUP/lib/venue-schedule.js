// Only explicit structured performances are imported; never invent showtimes.
export function parseVenueSchedule(html, venue) {
 const rows=[];
 function visit(node) {
  if(Array.isArray(node)){node.forEach(visit);return;}
  if(!node||typeof node!=='object')return;
  const types=[node['@type']].flat();
  if(types.some(t=>typeof t==='string'&&/Event$/.test(t)) && typeof node.name==='string' && typeof node.startDate==='string') {
   const m=node.startDate.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
   if(m && !String(node.eventStatus||'').endsWith('EventCancelled')) {
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
