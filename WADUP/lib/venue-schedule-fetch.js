import { EVENT_VENUES } from './event-venues.js';
import { allianceProduction, parseAllianceShowtimes, parseFoxShowings, parseSignalSchedule, parseTivoliSchedule, parseVenueSchedule } from './venue-schedule.js';
import { fetchSongbirdsEvents, usesSongbirdsFeed } from './songbirdsEvents.mjs';

const EASTERN_FEED = 'https://aegwebprod.blob.core.windows.net/json/events/127/events.json';

async function fetchAllianceShowings(html, venue, fetcher, today) {
 const paths=[...new Set([...html.matchAll(/href="(?:https:\/\/www\.alliancetheatre\.org)?(\/production\/\d{4}-\d{2}\/[\w%-]+\/)"/gi)].map(match=>match[1]))];
 const selected=paths.slice(0,35);
 const rows=[];
 let partial=selected.length<paths.length;
 const signal=AbortSignal.timeout(22000);
 for(let i=0;i<selected.length&&!signal.aborted;i+=5){
  const batch=await Promise.allSettled(selected.slice(i,i+5).map(async path=>{
   const url=new URL(path,venue.website).href;
   const detail=await fetcher(url,{redirect:'error',signal});
   if(!detail.ok)throw Error('Alliance production unavailable');
   const production=allianceProduction(await detail.text(),url);
   if(!production||production.end<today)return [];
   const body=new URLSearchParams({action:'oms_productions_ticket_widget_ajax_callback',post_id:production.postId,production_seasons_id:production.seasonsId});
   const response=await fetcher(new URL('/wp-admin/admin-ajax.php',venue.website).href,{method:'POST',body,redirect:'error',signal});
   if(!response.ok)throw Error('Alliance box office unavailable');
   const {html:widget}=await response.json();
   if(typeof widget!=='string')throw Error('Alliance widget malformed');
   return parseAllianceShowtimes(widget,production,venue.id);
  }));
  for(const result of batch) {
   if(result.status==='fulfilled')rows.push(...result.value);
   else partial=true;
  }
 }
 return {rows,partial:partial||signal.aborted};
}

async function fetchFoxShowings(html, venue, fetcher) {
 const paths=[...new Set([...html.matchAll(/href="(?:https:\/\/www\.foxtheatre\.org)?(\/events\/detail\/[\w%-]+)"/gi)].map(match=>match[1]))];
 const selected=paths.slice(0,50);
 const rows=[];
 let partial=selected.length<paths.length;
 const signal=AbortSignal.timeout(8000);
 for(let i=0;i<selected.length&&!signal.aborted;i+=5){
  const batch=await Promise.allSettled(selected.slice(i,i+5).map(async path=>{
   const response=await fetcher(new URL(path,venue.website).href,{redirect:'error',signal});
   if(!response.ok)throw Error('Fox performance unavailable');
   return parseFoxShowings(await response.text(),venue.id);
  }));
  for(const result of batch){
   if(result.status==='fulfilled')rows.push(...result.value);
   else partial=true;
  }
 }
 return {rows,partial:partial||signal.aborted};
}

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
   return {venueId,status:rows.length?'parsed':'unknown',reason:rows.length?null:'no structured performances found',rows,complete:rows.length>0,checkedAt:new Date().toISOString()};
  }
  const response=await fetcher(url.href,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'text/html'}});
  if(!response.ok) return {venueId,status:'unknown',reason:'HTTP '+response.status,rows:[]};
  const reader=response.body.getReader();
  const decoder=new TextDecoder();let html='',bytes=0;
  try {
   const byteLimit=venue.sharedSchedule?4000000:2000000;
   while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>byteLimit)return {venueId,status:'unknown',reason:'response too large',rows:[]};html+=decoder.decode(value,{stream:true});}
   html+=decoder.decode();
  } finally {await reader.cancel().catch(()=>{});}
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York'}).format(new Date());
  let performances;
  let partial=false;
  if(venue.id==='chattanooga-the-signal') performances=parseSignalSchedule(html,venue);
  else if(venue.id==='atlanta-fox') ({rows:performances,partial}=await fetchFoxShowings(html,venue,fetcher));
  else if(venue.id==='atlanta-alliance-theatre') ({rows:performances,partial}=await fetchAllianceShowings(html,venue,fetcher,today));
  else if(venue.sharedSchedule) performances=parseTivoliSchedule(html,venue);
  else performances=parseVenueSchedule(html,venue);
  const rows=performances.filter(row=>row.dateStr>=today);
  return {venueId,status:rows.length?(partial?'partial':'parsed'):'unknown',reason:partial?'official schedule returned a partial result':rows.length?null:'no structured performances found',rows,complete:rows.length>0&&!partial,checkedAt:new Date().toISOString()};
 }catch{return {venueId,status:'unknown',reason:'fetch failed',rows:[]};}
}
