import { EVENT_VENUES } from './event-venues';
import { parseVenueSchedule } from './venue-schedule';

// Only registry-controlled HTTPS destinations; no arbitrary user URLs.
// An empty parse is not evidence that a venue has no upcoming events.
export async function fetchOfficialSchedule(venueId, fetcher=fetch) {
 const venue=EVENT_VENUES.find(v=>v.id===venueId);
 if(!venue) throw new Error('Unknown venue');
 const url=new URL(venue.scheduleUrl||venue.website);
 if(url.protocol!=='https:' || url.hostname!==new URL(venue.website).hostname) throw new Error('Invalid schedule URL');
 try {
  const response=await fetcher(url.href,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'text/html'}});
  if(!response.ok) return {venueId,status:'unknown',reason:'HTTP '+response.status,rows:[]};
  const reader=response.body.getReader();
  const decoder=new TextDecoder();let html='',bytes=0;
  try {
   while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2000000)return {venueId,status:'unknown',reason:'response too large',rows:[]};html+=decoder.decode(value,{stream:true});}
   html+=decoder.decode();
  } finally {await reader.cancel().catch(()=>{});}
  const rows=parseVenueSchedule(html,venue);
  return {venueId,status:rows.length?'parsed':'unknown',reason:rows.length?null:'no structured performances found',rows,checkedAt:new Date().toISOString()};
 }catch{return {venueId,status:'unknown',reason:'fetch failed',rows:[]};}
}
