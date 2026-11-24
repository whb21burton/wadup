import test from 'node:test';
import assert from 'node:assert/strict';
import {ticketDestination,ticketStatus,suppressTicketDuplicates} from '../lib/ticket-quality.js';
import {parseVenueSchedule,matchPerformance} from '../lib/venue-schedule.js';
import {matchEventVenue} from '../lib/event-venues.js';
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
