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
    try {
     const u=new URL(node.url||venue.website,venue.website);
     const eventTicket=u.hostname===venue.ticketHost && /\/event\/[A-Z0-9]+\/?$/i.test(u.pathname);
     if(u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname===new URL(venue.website).hostname||eventTicket))officialUrl=u.href;
    }catch{}
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
 const norm=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 return Boolean(official.venueId && official.timeStr && source.timeStr &&
  official.venueId===source.venueId && norm(official.name)===norm(source.name) &&
  official.dateStr===source.dateStr && official.timeStr.slice(0,5)===source.timeStr.slice(0,5));
}

export function parseSignalSchedule(html, venue) {
 const rows=[];
 for(const [, article] of html.matchAll(/<article\b[^>]*class="[^"]*\beventlist-event\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)) {
  const event=article.match(/<a href="(\/tickets\/[\w%-]+)" class="eventlist-title-link">([^<]+)<\/a>/i);
  const start=article.match(/<time class="event-time-localized(?:-start)?" datetime="(\d{4}-\d{2}-\d{2})">\s*(1[0-2]|[1-9]):([0-5]\d)\s*([AP]M)\s*<\/time>/i);
  if(!event || !start || /\b(?:canceled|cancelled|postponed)\b/i.test(event[2]))continue;
  const [,dateStr,hour,minute,period]=start;
  const hour24=Number(hour)%12+(period.toUpperCase()==='PM'?12:0);
  const name=event[2].replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim();
  const tickets=article.match(/href="(https:\/\/www\.axs\.com\/events\/\d+\/[^"]+)"/i)?.[1];
  rows.push({venueId:venue.id,name,dateStr,timeStr:`${String(hour24).padStart(2,'0')}:${minute}:00`,officialUrl:tickets?.replace(/&amp;/g,'&')||new URL(event[1],venue.website).href,source:'official-venue'});
 }
 return rows;
}

export function parseFoxShowings(html, venueId) {
 const name=html.match(/<meta\b[^>]*property="og:title"\s+content="([^"]+)"/i)?.[1]?.replace(/\s*\|\s*Fox Theatre\s*$/i,'').trim();
 if(!name || /\b(?:canceled|cancelled|postponed)\b/i.test(name))return [];
 const rows=[];
 for(const [,url,month,day,year,hour,minute,period] of html.matchAll(/<a\b[^>]*href="(https:\/\/foxtheatre\.evenue\.net\/[^"]+)"[^>]*title="Buy Tickets for ([A-Za-z]+) (\d{1,2}) (\d{4}) at (1[0-2]|[1-9]):([0-5]\d) ([AP]M)"/gi)) {
  const date=new Date(`${month} ${day}, ${year} UTC`);
  if(!Number.isFinite(date.getTime()))continue;
  const hour24=Number(hour)%12+(period.toUpperCase()==='PM'?12:0);
  rows.push({venueId,name,dateStr:date.toISOString().slice(0,10),timeStr:`${String(hour24).padStart(2,'0')}:${minute}:00`,officialUrl:url.replace(/&amp;/g,'&'),source:'official-venue'});
 }
 return rows;
}

export function parseTivoliSchedule(html, venue) {
 const start=html.indexOf('window.__NUXT__=(function(');
 if(start<0)return [];
 const script=html.slice(start,html.indexOf('</script>',start));
 const parameters=script.match(/^window\.__NUXT__=\(function\(([\w$,]+)\)/)?.[1]?.split(',');
 const argumentStart=script.lastIndexOf('}}(');
 if(!parameters || argumentStart<0 || !/\)\);\s*$/.test(script))return [];
 let values;
 try { values=JSON.parse(`[${script.slice(argumentStart+3).replace(/\)\);\s*$/,'')}]`); }
 catch { return []; }
 if(parameters.length!==values.length)return [];
 const bindings=new Map(parameters.map((key,i)=>[key,values[i]]));
 const token='("(?:[^"\\\\]|\\\\.)*"|[\\w$]+)';
 const field=(record,key)=>{
  const value=record.match(new RegExp(`(?:^|,)${key}:${token}`))?.[1];
  return value?.startsWith('"') ? JSON.parse(value) : bindings.get(value);
 };
 const rows=new Map();
 const aliases=venue.aliases.map(name=>name.toLowerCase());
 for(const [,record] of script.slice(0,argumentStart).matchAll(/\{(id:[^{}]{1,2600}?main_venue_event_id:[^{}]{1,120})\}/g)) {
  const venueName=field(record,'venue_name');
  if(typeof venueName!=='string'||!aliases.includes(venueName.trim().toLowerCase())||field(record,'is_addon')!==false)continue;
  const name=field(record,'title');
  const datetime=field(record,'effective_datetime');
  const officialUrl=field(record,'buy_tickets_link');
  if(typeof name!=='string'||!name.trim()||/\b(?:canceled|cancelled|postponed)\b/i.test(name)||
     !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?-0[45]:00$/.test(datetime||'')||
     !/^https:\/\/www\.ticketmaster\.com\/event\/[A-Z0-9]+(?:\?|$)/i.test(officialUrl||''))continue;
  const dateStr=datetime.slice(0,10),timeStr=datetime.slice(11,19);
  rows.set(JSON.stringify([name,dateStr,timeStr]),{venueId:venue.id,name,dateStr,timeStr,officialUrl,source:'official-venue'});
 }
 return [...rows.values()];
}

export function parseAllianceShowtimes(html, production, venueId) {
 const rows=new Map();
 const startYear=Number(production.start.slice(0,4));
 const endYear=Number(production.end.slice(0,4));
 if(!Number.isInteger(startYear)||!Number.isInteger(endYear)||endYear-startYear>1)return [];
 for(const [,url,month,day,hour,minute,period] of html.matchAll(/href="(https:\/\/my\.alliancetheatre\.org\/\d+\/\d+\/?(?:\?[^"\s]*)?)"\s+aria-label="Buy Tickets for the performance on ([A-Za-z]+) (\d{1,2}) at (1[0-2]|[1-9]):([0-5]\d) ([AP]M)"/gi)) {
  const dates=[];
  for(let year=startYear;year<=endYear;year++){
   const date=new Date(`${month} ${day}, ${year} UTC`);
   if(!Number.isFinite(date.getTime())||date.getUTCDate()!==Number(day))continue;
   const iso=date.toISOString().slice(0,10);
   if(iso>=production.start&&iso<=production.end)dates.push(iso);
  }
  if(dates.length!==1)continue;
  const hour24=Number(hour)%12+(period.toUpperCase()==='PM'?12:0);
  const timeStr=`${String(hour24).padStart(2,'0')}:${minute}:00`;
  rows.set(`${dates[0]}T${timeStr}`,{venueId,name:production.name,dateStr:dates[0],timeStr,officialUrl:url.replace(/&amp;/g,'&'),source:'official-venue'});
 }
 return [...rows.values()];
}

export function allianceProduction(html, pageUrl) {
 const widget=html.match(/<div\b[^>]*class="js-tnew-buy-tickets-widget-injection"[\s\S]*?>/i)?.[0];
 const postId=widget?.match(/data-ajax-post-id="(\d+)"/)?.[1];
 const seasonsId=widget?.match(/data-production-seasons-id="([\d, ]+)"/)?.[1];
 if(!postId||!seasonsId)return null;
 for(const [,script] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  let data;
  try{data=JSON.parse(script);}catch{continue;}
  for(const event of [data].flat().flatMap(value=>value?.['@graph']||value)){
   if(!event?.name||!/^\d{4}-\d{2}-\d{2}T/.test(event.startDate||''))continue;
   if(typeof event.url==='string'&&event.url.replace(/\/$/,'')!==pageUrl.replace(/\/$/,''))continue;
   const numericEnd=String(event.endDate||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
   const end=numericEnd ? `${numericEnd[3]}-${numericEnd[1].padStart(2,'0')}-${numericEnd[2].padStart(2,'0')}` :
    typeof event.url==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(event.endDate||'') ? event.endDate.slice(0,10) : null;
   if(end)return {name:event.name,start:event.startDate.slice(0,10),end,postId,seasonsId};
  }
 }
 return null;
}
