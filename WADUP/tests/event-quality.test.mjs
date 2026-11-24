import test from 'node:test';
import assert from 'node:assert/strict';
import {ticketDestination,ticketStatus,suppressTicketDuplicates} from '../lib/ticket-quality.js';
import {parseVenueSchedule,matchPerformance} from '../lib/venue-schedule.js';
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
