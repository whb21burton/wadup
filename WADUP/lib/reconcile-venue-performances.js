import {matchPerformance} from './venue-schedule.js';
import {ticketDestination,ticketStatus,ticketQuality,preferredTicketRecord} from './ticket-quality.js';
function providerPerformance(url){
 const destination=ticketDestination(url);
 if(!destination)return null;
 const {hostname,pathname}=new URL(destination);
 const ticketmaster=pathname.match(/\/event\/([a-z0-9_-]+)\/?$/i);
 if(ticketmaster&&/(?:^|\.)ticketmaster\.(?:com|ca)$/.test(hostname))return 'ticketmaster:'+ticketmaster[1].toUpperCase();
 const axs=pathname.match(/^\/events\/(\d+)(?:\/|$)/);
 return axs&&hostname==='www.axs.com' ? 'axs:'+axs[1] : null;
}
export function reconcileVenuePerformances(officialRows,ticketRows){
 const consumed=new Set();
 const ticketRowsByVenue=new Map();
 for(const row of ticketRows){
  if(!row.venueId)continue;
  if(!ticketRowsByVenue.has(row.venueId))ticketRowsByVenue.set(row.venueId,[]);
  ticketRowsByVenue.get(row.venueId).push(row);
 }
 const performances=officialRows.map(official=>{
  const providerId=providerPerformance(official.officialUrl);
  const matches=(ticketRowsByVenue.get(official.venueId)||[]).filter(t=>matchPerformance(official,t)||
   (providerId&&official.dateStr===t.dateStr&&official.timeStr&&t.timeStr&&
    official.timeStr.slice(0,5)===t.timeStr.slice(0,5)&&providerPerformance(t.url)===providerId));
  matches.forEach(t=>consumed.add(t));
  const usable=matches.filter(t=>ticketStatus(t)==='working'&&ticketQuality(t.url));
  const preferred=usable.reduce((a,b)=>a?preferredTicketRecord(a,b):b,null);
  const destination=ticketDestination(official.officialUrl);
  const dead=destination&&matches.some(row=>ticketStatus(row)==='dead'&&
   (ticketDestination(row.url)===destination||(providerId&&providerPerformance(row.url)===providerId)));
  const officialUrl=dead ? null : official.officialUrl;
  return {...official,officialUrl,ticketCandidates:matches,preferredTicket:preferred,
   purchaseUrl:preferred?.url||officialUrl,
   purchaseSource:preferred?'ticket-provider':'official-venue',
   purchaseStatus:preferred?ticketStatus(preferred):'official-fallback'};
 });
 return {performances,unmatchedTicketRows:ticketRows.filter(t=>!consumed.has(t))};
}
