import { EVENT_VENUES } from './event-venues.js';
import { parseSignalSchedule, parseVenueSchedule } from './venue-schedule.js';
import { fetchSongbirdsEvents, usesSongbirdsFeed } from './songbirdsEvents.mjs';

const EASTERN_FEED = 'https://aegwebprod.blob.core.windows.net/json/events/127/events.json';

async function fetchEasternEvents(venueId, fetcher) {
 const response=await fetcher(EASTERN_FEED,{redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('Eastern calendar unavailable');
 const {events}=await response.json();
 if(!Array.isArray(events))throw new Error('Invalid Eastern calendar response');
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York'}).format(new Date());
 return events.flatMap(event=>{
  const start=event.eventDateTime;
  const name=event.title?.eventTitleText?.trim();
  if(event.active!==true || event.private!==false || event.publishStatus!==1 || !name ||
     event.eventDateTimeZone!=='America/New_York' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(start) ||
     start.slice(0,10)<today || /cancel|postpon/i.test(event.ticketing?.status||''))return [];
  const officialUrl=event.ticketing?.eventUrl;
  if(!/^https:\/\/www\.axs\.com\/events\/\d+(?:\/|$)/.test(officialUrl||''))return [];
  return [{venueId,name,dateStr:start.slice(0,10),timeStr:start.slice(11),officialUrl,source:'official-venue'}];
 });
}

// Only registry-controlled HTTPS destinations; no arbitrary user URLs.
// An empty parse is not evidence that a venue has no upcoming events.
export async function fetchOfficialSchedule(venueId, fetcher=fetch) {
 const venue=EVENT_VENUES.find(v=>v.id===venueId);
 if(!venue) throw new Error('Unknown venue');
 const url=new URL(venue.scheduleUrl||venue.website);
 if(url.protocol!=='https:' || url.hostname!==new URL(venue.website).hostname) throw new Error('Invalid schedule URL');
 try {
  if(usesSongbirdsFeed(url.href) || venue.id==='atlanta-eastern') {
   const rows=venue.id==='atlanta-eastern' ? await fetchEasternEvents(venue.id,fetcher) : await fetchSongbirdsEvents(venue.id,fetcher);
   return {venueId,status:rows.length?'parsed':'unknown',reason:rows.length?null:'no structured performances found',rows,checkedAt:new Date().toISOString()};
  }
  const response=await fetcher(url.href,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'text/html'}});
  if(!response.ok) return {venueId,status:'unknown',reason:'HTTP '+response.status,rows:[]};
  const reader=response.body.getReader();
  const decoder=new TextDecoder();let html='',bytes=0;
  try {
   while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2000000)return {venueId,status:'unknown',reason:'response too large',rows:[]};html+=decoder.decode(value,{stream:true});}
   html+=decoder.decode();
  } finally {await reader.cancel().catch(()=>{});}
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York'}).format(new Date());
  const rows=(venue.id==='chattanooga-the-signal' ? parseSignalSchedule(html,venue) : parseVenueSchedule(html,venue))
   .filter(row=>row.dateStr>=today);
  return {venueId,status:rows.length?'parsed':'unknown',reason:rows.length?null:'no structured performances found',rows,checkedAt:new Date().toISOString()};
 }catch{return {venueId,status:'unknown',reason:'fetch failed',rows:[]};}
}
