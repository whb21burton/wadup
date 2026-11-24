// Venue identities are independent of ticket-provider IDs.
// Coordinates must be verified before being used to replace source coordinates.
export const EVENT_VENUES = [
 {id:'chattanooga-the-signal',name:'The Signal',city:'Chattanooga',state:'TN',type:'music',emoji:'🎵',website:'https://www.thesignaltn.com/',aliases:['The Signal','The Signal - Concert Hall']},
 {id:'atlanta-alliance-theatre',name:'Alliance Theatre',city:'Atlanta',state:'GA',type:'theater',emoji:'🎭',website:'https://www.alliancetheatre.org/',aliases:['Alliance Theatre','Alliance Theatre - Coca-Cola Stage']}
];
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function matchEventVenue(event) {
 const name=normalize(event.venue_name||event.venueName);
 return EVENT_VENUES.find(v=>normalize(v.city)===normalize(event.city)&&normalize(v.state)===normalize(event.state)&&v.aliases.some(a=>normalize(a)===name))||null;
}
