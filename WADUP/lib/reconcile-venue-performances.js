import {matchPerformance} from './venue-schedule.js';
import {ticketDestination,ticketStatus,ticketQuality,preferredTicketRecord} from './ticket-quality.js';
import {matchEventVenue} from './event-venues.js';
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

export function mergeOfficialEventRows(officialRows, ticketRows) {
 const locatedRows = officialRows.filter(({location}) => Number.isFinite(location?.lat) && Number.isFinite(location?.lng));
 if (!locatedRows.length) return ticketRows;
 const tickets = ticketRows.map(row => ({...row, venueId: matchEventVenue(row)?.id, dateStr: row.date_str, timeStr: row.time_str}));
 const {performances, unmatchedTicketRows} = reconcileVenuePerformances(locatedRows, tickets);
 return [...unmatchedTicketRows, ...performances.map(performance => {
  const {location, preferredTicket} = performance;
  return {...preferredTicket,
   tm_id: preferredTicket?.tm_id || 'official_' + [performance.venueId, performance.name, performance.dateStr, performance.timeStr].map(encodeURIComponent).join('_'),
   name: performance.name, venue_name: performance.venueName, city: performance.city, state: performance.state,
   lat: location.lat, lng: location.lng, address: location.address,
   date_str: performance.dateStr, time_str: performance.timeStr,
   segment: preferredTicket?.segment || (performance.venueType === 'theater' ? 'Theater' : 'Music'),
   official_url: performance.officialUrl, is_official: true, url: preferredTicket?.url || '',
  };
 })];
}
