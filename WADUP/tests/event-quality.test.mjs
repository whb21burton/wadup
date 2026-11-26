import test from 'node:test';
import assert from 'node:assert/strict';
import {affiliateTicketUrl,ticketDestination,ticketFallback,ticketStatus,suppressTicketDuplicates} from '../lib/ticket-quality.js';
import {allianceProduction,parseAllianceShowtimes,parseFoxShowings,parseSignalSchedule,parseTivoliSchedule,parseVenueSchedule,matchPerformance} from '../lib/venue-schedule.js';
import {mergeOfficialEventRows,reconcileVenuePerformances} from '../lib/reconcile-venue-performances.js';
import {canRunLegacyCron} from '../lib/cron-auth.js';
import {verifyTicket} from '../lib/ticket-verifier.js';
import {renderEventPopup} from '../lib/event-popup.js';
import {fetchOfficialSchedule} from '../lib/venue-schedule-fetch.js';
import {matchEventVenue} from '../lib/event-venues.js';
import {fetchSongbirdsEvents} from '../lib/songbirdsEvents.mjs';
test('reported Lupita duplicate is suppressed only when replacement exists',()=>{
 const bad={tm_id:'Z7r9jZ1A7Pv4y'},good={tm_id:'rZ7HnEZ1Afr3OS'};
 assert.deepEqual(suppressTicketDuplicates([bad,good]),[good]);
 assert.deepEqual(suppressTicketDuplicates([bad]),[bad]);
});
test('partner affiliate destinations remain eligible',()=>{
 const url='https://www.ticketweb.com/event/example/123';
 assert.equal(ticketDestination('https://ticketmaster.evyy.net/c/APP/264167/4272?u='+encodeURIComponent(url)),url);
 assert.equal(ticketDestination('https://www.ticketweb.com.evil.example/event/123'),null);
});
test('unknown links are not classified as dead',()=>{
 assert.equal(ticketStatus({tm_id:'new',url:'https://www.ticketmaster.com/event/123'}),'unknown');
});
test('official calendar retains distinct performances and excludes canceled ones',()=>{
 const venue={id:'alliance',website:'https://www.alliancetheatre.org/'};
 const events=['14:00','19:00'].map(time=>({'@type':'TheaterEvent',name:'A Christmas Carol',startDate:'2026-11-28T'+time+':00-05:00'}));
 const rows=parseVenueSchedule('<script type="application/ld+json">'+JSON.stringify([...events,{...events[0],eventStatus:'https://schema.org/EventCancelled'}])+'</script>',venue);
 assert.equal(rows.length,2);
 assert.equal(matchPerformance(rows[0],rows[1]),false);
 assert.equal(matchPerformance(rows[0],rows[0]),true);
});
test('venue aliases resolve to same identity',()=>{
 const base={city:'Chattanooga',state:'TN'};
 assert.equal(matchEventVenue({...base,venue_name:'The Signal'}).id,matchEventVenue({...base,venue_name:'The Signal - Concert Hall'}).id);
});
test('shared calendars only attribute performances to the listed theater',()=>{
 const venue={id:'walker',website:'https://tivolichattanooga.com/',sharedSchedule:true,aliases:['Walker Theatre','The Walker Theatre']};
 const base={'@type':'TheaterEvent',name:'Show',startDate:'2026-12-01T19:00:00-05:00'};
 const events=[base,{...base,location:{name:'Tivoli Theatre'}},{...base,location:{name:'The Walker Theatre'}}];
 assert.equal(parseVenueSchedule('<script type="application/ld+json">'+JSON.stringify(events)+'</script>',venue).length,1);
});
test('Tabernacle uses the exact Ticketmaster event URL published by the venue',()=>{
 const venue=matchEventVenue({venue_name:'Tabernacle',city:'Atlanta',state:'GA'});
 const tickets='https://www.ticketmaster.com/example/event/0E00652BADD4C700';
 const data={'@type':'MusicEvent',name:'Show',startDate:'2026-11-24T20:00:00',url:tickets};
 const parse=node=>parseVenueSchedule('<script type="application/ld+json">'+JSON.stringify(node)+'</script>',venue)[0].officialUrl;
 assert.equal(parse(data),tickets);
 assert.equal(parse({...data,url:tickets.replace('.com/','.com.example/')}),venue.website);
});
test('Fox Theatre pairs each showing with its own published link',()=>{
 const html='<meta property="og:title" content="Show | Fox Theatre" />'+
  '<a href="https://foxtheatre.evenue.net/events/MAT" title="Buy Tickets for December 4 2026 at 2:00 PM">Buy Tickets</a>'+
  '<a href="https://foxtheatre.evenue.net/events/EVE" title="Buy Tickets for December 4 2026 at 7:30 PM">Buy Tickets</a>';
 assert.deepEqual(parseFoxShowings(html,'atlanta-fox').map(row=>[row.dateStr,row.timeStr,row.officialUrl]),[
  ['2026-12-04','14:00:00','https://foxtheatre.evenue.net/events/MAT'],
  ['2026-12-04','19:30:00','https://foxtheatre.evenue.net/events/EVE'],
 ]);
});
test('Songbirds retains each official start and its ticket link across calendar pages',async()=>{
 const base={status:'publish',timezone:'America/New_York',all_day:false,title:'Show',url:'https://venue.songbirds.org/event/show/'};
 const fetcher=async url=>{
  const page=new URL(url).searchParams.get('page');
  const event={...base,start_date:`2026-12-04 ${page==='1'?'14':'19'}:00:00`,website:`https://eventim.us/show-${page}`};
  return Response.json({total_pages:2,events:[event,{...event,title:'No start',start_date:null},{...event,title:'All day',all_day:true}]});
 };
 const rows=await fetchSongbirdsEvents('songbirds',fetcher,new Date('2026-11-24T13:00:00Z'));
 assert.deepEqual(rows.map(row=>[row.timeStr,row.officialUrl]),[
  ['14:00:00','https://eventim.us/show-1'],['19:00:00','https://eventim.us/show-2'],
 ]);
});
test('cron authentication requires a configured matching secret',()=>{
 assert.equal(canRunLegacyCron({},{}),false);
 assert.equal(canRunLegacyCron({authorization:'Bearer undefined'},{}),false);
 assert.equal(canRunLegacyCron({authorization:'Bearer secret'},{CRON_SECRET:'secret'}),true);
 assert.equal(canRunLegacyCron({'x-admin-password':'password'},{ADMIN_SYNC_PASSWORD:'password'}),true);
});
test('affiliate links preserve the exact destination, including performance parameters',()=>{
 const url='https://www.ticketmaster.com/event/1B00655CBAEA15B4?brand=walker';
 const tracked=affiliateTicketUrl(affiliateTicketUrl(url,'APP'),'test');
 assert.equal(ticketDestination(tracked),url);
 assert.match(tracked,/^https:\/\/ticketmaster\.evyy\.net\/c\/test\//);
 const partner='https://www.ticketweb.com/event/artist/123?pl=abc';
 const linked=`https://ticketmaster.evyy.net/c/APP/264167/4272?u=${encodeURIComponent(partner)}`;
 assert.equal(affiliateTicketUrl(linked,'test'),linked);
});
test('reconciliation matches accent variations but preserves individual Alliance showtimes',()=>{
 const base={venueId:'alliance',name:'A Christmas Carol',dateStr:'2026-12-04',officialUrl:'https://www.alliancetheatre.org/production/christmas-carol/'};
 const rows=['14:00:00','17:00:00','19:00:00'].map(timeStr=>({...base,timeStr}));
 const url='https://www.ticketmaster.com/event/AB0123';
 const tickets=[{...rows[0],name:'A Chrístmas Carol',url,ticket_verification:{url,status:'working',expires_at:'2099-01-01'}},
  {...rows[1],tm_id:'Z7r9jZ1A70gug',url}, {...rows[2],dateStr:'2026-12-05',url}];
 const result=reconcileVenuePerformances(rows,tickets);
 assert.deepEqual(result.performances.map(p=>[p.timeStr,p.purchaseUrl]),[
  ['14:00:00',url],['17:00:00',base.officialUrl],['19:00:00',base.officialUrl],
 ]);
 assert.equal(result.unmatchedTicketRows[0].dateStr,'2026-12-05');
 assert.equal(ticketStatus(tickets[1]),'dead');
 assert.match(ticketFallback(tickets[1]).url,/alliancetheatre\.org/);
});
test('serialized Tivoli calendar preserves Walker venue attribution and Eastern showtime',()=>{
 const html='<script>window.__NUXT__=(function(a,b,c,d){return {events:[{id:"walker",title:a,is_addon:b,venue_name:c,buy_tickets_link:"https://www.ticketmaster.com/event/ABC?brand=walker",effective_datetime:"2026-12-12T14:00:00.000-05:00",main_venue_event_id:d}]}}("Elf",false,"The Walker Theatre",null));</script>';
 assert.deepEqual(parseTivoliSchedule(html,{id:'tivoli',aliases:['Tivoli Theatre']}),[]);
 const rows=parseTivoliSchedule(html,{id:'walker',aliases:['Walker Theatre','The Walker Theatre']});
 assert.equal(rows[0]?.timeStr,'14:00:00');
 assert.equal(rows[0]?.officialUrl,'https://www.ticketmaster.com/event/ABC?brand=walker');
});
test('Alliance binds showtime to the exact link and derives the year from the official run',()=>{
 const page='https://www.alliancetheatre.org/production/2026-27/show/';
 const widget='<div class="js-tnew-buy-tickets-widget-injection" data-ajax-post-id="1" data-production-seasons-id="2"></div>';
 const metadata={name:'Show',startDate:'2026-12-18T00:00:00+0000',endDate:'1/4/2027'};
 const production=allianceProduction(widget+`<script type="application/ld+json">${JSON.stringify(metadata)}</script>`,page);
 const showing=(id,date,time)=>`<a href="https://my.alliancetheatre.org/2/${id}" aria-label="Buy Tickets for the performance on ${date} at ${time}">${time}</a>`;
 const rows=parseAllianceShowtimes(showing(11,'Jan 2','2:00 PM')+showing(12,'Jan 2','7:00 PM')+showing(13,'Feb 2','7:00 PM'),production,'alliance');
 assert.deepEqual(rows.map(row=>[row.dateStr,row.timeStr,row.officialUrl]),[
  ['2027-01-02','14:00:00','https://my.alliancetheatre.org/2/11'],['2027-01-02','19:00:00','https://my.alliancetheatre.org/2/12'],
 ]);
});
test('map rows keep separate canonical showtimes and preserve tickets outside the official date',()=>{
 const date='2026-12-05';
 const venue=matchEventVenue({venue_name:'Alliance Theatre',city:'Atlanta',state:'GA'});
 const first={venueId:venue.id,venueName:venue.name,venueType:venue.type,city:venue.city,state:venue.state,
  location:venue.location,name:'A Christmas Carol',dateStr:date,timeStr:'14:30',officialUrl:'https://www.alliancetheatre.org/show/afternoon'};
 const second={...first,timeStr:'19:30',officialUrl:'https://www.alliancetheatre.org/show/evening'};
 const ticket={tm_id:'first',venue_name:venue.name,city:venue.city,state:venue.state,name:first.name,
  date_str:date,time_str:first.timeStr,url:'https://www.ticketmaster.com/event/0001'};
 const tomorrow={...ticket,tm_id:'tomorrow',date_str:'2026-12-06'};
 const rows=mergeOfficialEventRows([first,second],[ticket,tomorrow]);
 assert.equal(rows.length,3);
 assert.ok(rows.includes(tomorrow) || rows.some(row=>row.tm_id===tomorrow.tm_id));
 assert.deepEqual(rows.filter(row=>row.is_official).map(row=>[row.lat,row.lng,row.time_str,row.official_url]),
  [first,second].map(show=>[venue.location.lat,venue.location.lng,show.timeStr,show.officialUrl]));
 assert.deepEqual(mergeOfficialEventRows([{...first,location:null}],[ticket]),[ticket]);
});
test('The Signal uses the first published time for a performance crossing midnight',()=>{
 const html='<article class="eventlist-event"><a href="/tickets/neon-nye-2026" class="eventlist-title-link">Neon Moon</a>'+
  '<time class="event-time-localized" datetime="2026-12-31">9:00 PM</time>'+
  '<time class="event-time-localized" datetime="2027-01-01">12:59 PM</time></article>';
 const [event]=parseSignalSchedule(html,{id:'signal',website:'https://www.thesignaltn.com/'});
 assert.deepEqual([event.dateStr,event.timeStr,event.officialUrl],['2026-12-31','21:00:00','https://www.thesignaltn.com/tickets/neon-nye-2026']);
});
test('ticket verification treats access blocks and temporary failures as inconclusive',async()=>{
 const url='https://www.ticketmaster.com/event/ABC123';
 const failure=status=>async()=>new Response(null,{status});
 assert.equal((await verifyTicket({url},null,failure(403))).status,'unknown');
 assert.equal((await verifyTicket({url},null,failure(503))).status,'unknown');
 const first=await verifyTicket({url},null,failure(404));
 const second=await verifyTicket({url},{...first,expires_at:'2000-01-01'},failure(404));
 assert.equal(first.status,'unknown');
 assert.equal(second.status,'dead');
 assert.equal((await verifyTicket({url},{...second,expires_at:'2000-01-01'},failure(403))).status,'dead');
});
test('same provider performance ID reconciles a title variation only at the exact venue and showtime',()=>{
 const official={name:'Venue title',venueId:'walker',dateStr:'2026-12-03',timeStr:'19:00:00',officialUrl:'https://www.ticketmaster.com/event/ABCD?brand=walker'};
 const url='https://ticketmaster.com/provider-title/event/ABCD';
 const ticket={...official,name:'Provider title',url,ticket_verification:{url,status:'working',expires_at:'2099-01-01'}};
 const unmatched={...ticket,timeStr:'14:00:00'};
 const result=reconcileVenuePerformances([official],[ticket,unmatched]);
 assert.equal(result.performances[0].purchaseUrl,url);
 assert.deepEqual(result.unmatchedTicketRows,[unmatched]);
});
test('rendered event popup orders links by showtime and labels official selectors',()=>{
 const dateStr='2026-12-04';
 const alliance='https://my.alliancetheatre.org/1/2';
 const selector='https://foxtheatre.evenue.net/cgi-bin/ncommerce3/SEGetGroupList?groupCode=SHOW';
 const affiliate='https://www.ticketmaster.com/event/ABCD?brand=walker';
 const html=renderEventPopup({name:'<Test>',cat:'events',showings:[
  {dateStr,timeStr:'19:00:00',officialUrl:selector},
  {dateStr:'2026-12-05',timeStr:'16:00:00',officialUrl:'https://example.org/wrong-day'},
  {dateStr,timeStr:'14:00:00',officialUrl:alliance},
  {dateStr,timeStr:'17:00:00',officialUrl:affiliate},
 ]},dateStr,'🎭','test');
 const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(link=>link[1]);
 assert.equal(hrefs.length,3);
 assert.equal(hrefs[0],alliance);
 assert.equal(ticketDestination(hrefs[1]),affiliate);
 assert.equal(hrefs[2],selector);
 assert.match(html,/Choose a performance on the official site/);
 assert.match(html,/&lt;Test&gt;/);
});
test('a failed Alliance production leaves the successful showtime and reports a partial scrape',async()=>{
 const site='https://www.alliancetheatre.org';
 const first='/production/2099-00/first/', second='/production/2099-00/second/';
 const fetcher=async address=>{
  const path=new URL(address).pathname;
  if(path==='/shows/')return new Response(`<a href="${first}">First</a><a href="${second}">Second</a>`);
  if(path===second)return new Response(null,{status:503});
  if(path===first)return new Response('<div class="js-tnew-buy-tickets-widget-injection" data-ajax-post-id="1" data-production-seasons-id="2"></div>'+
   `<script type="application/ld+json">${JSON.stringify({name:'First',url:site+first,startDate:'2099-12-01T00:00:00',endDate:'2099-12-30T00:00:00'})}</script>`);
  return Response.json({html:'<a href="https://my.alliancetheatre.org/2/1" aria-label="Buy Tickets for the performance on Dec 5 at 2:00 PM">2:00 PM</a>'});
 };
 const result=await fetchOfficialSchedule('atlanta-alliance-theatre',fetcher);
 assert.equal(result.status,'partial');
 assert.equal(result.complete,false);
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].timeStr,'14:00:00');
});

test('a nonempty official calendar can retire stale rows, but a rate-limited calendar cannot', async()=>{
 const event={'@type':'MusicEvent',name:'Fixture Tour',startDate:'2099-12-04T19:00:00',
  url:'https://www.ticketmaster.com/event/ABCD'};
 const healthy=await fetchOfficialSchedule('atlanta-tabernacle',async()=>new Response(
  `<script type="application/ld+json">${JSON.stringify(event)}</script>`));
 assert.equal(healthy.complete,true);
 assert.equal(healthy.rows.length,1);
 const blocked=await fetchOfficialSchedule('atlanta-tabernacle',async()=>new Response(null,{status:429}));
 assert.equal(blocked.complete===true,false);
 assert.equal(blocked.reason,'HTTP 429');
});
