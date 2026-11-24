// Venue identities are independent of ticket-provider IDs.
// Coordinates must be verified before being used to replace source coordinates.
export const EVENT_VENUES = [
 {id:'chattanooga-the-signal',name:'The Signal',city:'Chattanooga',state:'TN',type:'music',emoji:'🎵',website:'https://www.thesignaltn.com/',scheduleUrl:'https://www.thesignaltn.com/tickets',aliases:['The Signal','The Signal - Concert Hall']},
 {id:'atlanta-alliance-theatre',name:'Alliance Theatre',city:'Atlanta',state:'GA',type:'theater',emoji:'🎭',website:'https://www.alliancetheatre.org/',aliases:['Alliance Theatre','Alliance Theatre - Coca-Cola Stage'],location:{lat:33.797401,lng:-84.386803,address:'1280 Peachtree St NE',status:'source-consensus'}},
{"id":"chattanooga-tivoli","name":"Tivoli Theatre","city":"Chattanooga","state":"TN","type":"theater","emoji":"🎭","website":"https://tivolichattanooga.com/","aliases":["Tivoli Theatre"]},
{"id":"chattanooga-walker","name":"Walker Theatre","city":"Chattanooga","state":"TN","type":"theater","emoji":"🎭","website":"https://tivolichattanooga.com/","aliases":["Walker Theatre","The Walker Theatre"],"location":{"lat":35.048049,"lng":-85.305659,"address":"399 McCallie Avenue","status":"source-consensus"}},
{"id":"chattanooga-songbirds","name":"Songbirds","city":"Chattanooga","state":"TN","type":"music","emoji":"🎵","website":"https://venue.songbirds.org/","scheduleUrl":"https://venue.songbirds.org/concert-schedule/","aliases":["Songbirds","Songbirds Guitar Museum"]},
{"id":"atlanta-fox","name":"Fox Theatre","city":"Atlanta","state":"GA","type":"theater","emoji":"🎭","website":"https://www.foxtheatre.org/","aliases":["Fox Theatre","Fox Theatre Atlanta","Fox Theatre - Atlanta"]},
{"id":"atlanta-tabernacle","name":"Tabernacle","city":"Atlanta","state":"GA","type":"music","emoji":"🎵","website":"https://www.tabernacleatl.com/","aliases":["Tabernacle","The Tabernacle","Tabernacle Presented by iTHINK Financial"]},
{"id":"atlanta-eastern","name":"The Eastern","city":"Atlanta","state":"GA","type":"music","emoji":"🎵","website":"https://www.easternatl.com/","aliases":["The Eastern","The Eastern-GA"]}
];
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function matchEventVenue(event) {
 const name=normalize(event.venue_name||event.venueName);
 return EVENT_VENUES.find(v=>normalize(v.city)===normalize(event.city)&&normalize(v.state)===normalize(event.state)&&v.aliases.some(a=>normalize(a)===name))||null;
}
