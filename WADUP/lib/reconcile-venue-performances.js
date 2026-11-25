import {matchPerformance} from './venue-schedule.js';
import {ticketStatus,ticketQuality,preferredTicketRecord} from './ticket-quality.js';
export function reconcileVenuePerformances(officialRows,ticketRows){
 const consumed=new Set();
 const ticketRowsByVenue=new Map();
 for(const row of ticketRows){
  if(!row.venueId)continue;
  if(!ticketRowsByVenue.has(row.venueId))ticketRowsByVenue.set(row.venueId,[]);
  ticketRowsByVenue.get(row.venueId).push(row);
 }
 const performances=officialRows.map(official=>{
  const matches=(ticketRowsByVenue.get(official.venueId)||[]).filter(t=>matchPerformance(official,t));
  matches.forEach(t=>consumed.add(t));
  const usable=matches.filter(t=>ticketStatus(t)==='working'&&ticketQuality(t.url));
  const preferred=usable.reduce((a,b)=>a?preferredTicketRecord(a,b):b,null);
  return {...official,ticketCandidates:matches,preferredTicket:preferred,
   purchaseUrl:preferred?.url||official.officialUrl,
   purchaseSource:preferred?'ticket-provider':'official-venue',
   purchaseStatus:preferred?ticketStatus(preferred):'official-fallback'};
 });
 return {performances,unmatchedTicketRows:ticketRows.filter(t=>!consumed.has(t))};
}
