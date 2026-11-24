import {matchPerformance} from './venue-schedule';
import {ticketStatus,ticketQuality,preferredTicketRecord} from './ticket-quality';
export function reconcileVenuePerformances(officialRows,ticketRows){
 const consumed=new Set();
 const performances=officialRows.map(official=>{
  const matches=ticketRows.filter(t=>matchPerformance(official,t));
  matches.forEach(t=>consumed.add(t));
  const usable=matches.filter(t=>ticketStatus(t)!=='dead'&&ticketQuality(t.url));
  const preferred=usable.reduce((a,b)=>a?preferredTicketRecord(a,b):b,null);
  return {...official,ticketCandidates:matches,preferredTicket:preferred,
   purchaseUrl:preferred?.url||official.officialUrl,
   purchaseSource:preferred?'ticket-provider':'official-venue',
   purchaseStatus:preferred?ticketStatus(preferred):'official-fallback'};
 });
 return {performances,unmatchedTicketRows:ticketRows.filter(t=>!consumed.has(t))};
}
