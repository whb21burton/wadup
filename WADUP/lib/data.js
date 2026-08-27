// lib/data.js — venue data and heat scoring

export const DEFAULT_VENUES = [
  { id:'v1', name:'Tootsies Orchid Lounge', cat:'nightlife', emoji:'🍺', address:'422 Broadway, Nashville, TN 37203', state:'TN', city:'Nashville', phone:'(615) 726-0463', website:'tootsies.net', ig:'@tootsies', style:'hot', lng:-86.7816, lat:36.1591, live:true, hours:{sun:false,mon:false,tue:false,wed:true,thu:true,fri:true,sat:true}, events:[{date:'Mar 7',name:'Live Band Night'},{date:'Mar 14',name:'St. Patricks Special'}], signals:{checkin:8,ig:14,event:5,view:22} },
  { id:'v2', name:'Honest Pint',            cat:'nightlife', emoji:'🍺', address:'102 Tremont St, Chattanooga, TN 37405', state:'TN', city:'Chattanooga', phone:'(423) 648-7446', website:'honestpint.com', ig:'@honestpint', style:'cyan', lng:-85.3096, lat:35.0456, live:true, hours:{sun:false,mon:false,tue:true,wed:true,thu:true,fri:true,sat:true}, events:[{date:'Mar 8',name:'Trivia Night'}], signals:{checkin:3,ig:6,event:2,view:11} },
  { id:'v3', name:'Top Golf Chattanooga',   cat:'sports',    emoji:'⛳', address:'2020 Gunbarrel Rd, Chattanooga, TN 37421', state:'TN', city:'Chattanooga', phone:'(423) 531-0000', website:'topgolf.com', ig:'@topgolf', style:'cyan', lng:-85.2480, lat:35.0527, live:true, hours:{sun:true,mon:true,tue:true,wed:true,thu:true,fri:true,sat:true}, events:[], signals:{checkin:1,ig:2,view:8} },
  { id:'v4', name:'Punchline Comedy Club',  cat:'events',    emoji:'🎭', address:'280 Elizabeth St NE, Atlanta, GA 30307', state:'GA', city:'Atlanta', phone:'(404) 555-0101', website:'punchlinecomedy.com', ig:'@punchline_atl', style:'purple', lng:-84.3880, lat:33.7490, live:false, hours:{sun:false,mon:false,tue:false,wed:true,thu:true,fri:true,sat:true}, events:[{date:'Mar 15',name:'Comedy Showcase'},{date:'Mar 22',name:'Open Mic Night'}], signals:{checkin:5,ig:9,event:4,view:18} },
];

export function calcHeatScore(v) {
  if (!v.signals) return 0;
  const s = v.signals;
  let score = 0;
  score += (s.checkin || 0) * 12;
  score += (s.event   || 0) * 8;
  score += (s.ig      || 0) * 5;
  score += (s.view    || 0) * 2;
  score += (s.override || 0);
  if (v.events  && v.events.length)  score += v.events.length * 6;
  const openDays = v.hours ? Object.values(v.hours).filter(Boolean).length : 0;
  score += openDays * 3;
  return Math.min(score, 200);
}

export function calcHeatLevel(v) {
  const s = calcHeatScore(v);
  if (s >= 65) return 3;
  if (s >= 35) return 2;
  if (s >= 10) return 1;
  return 0;
}

export function getFlamesHtml(level) {
  return ['', '🔥', '🔥🔥', '🔥🔥🔥'][level] || '';
}

export function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function tmSegmentToCat(seg) {
  if (!seg) return 'events';
  const s = seg.toLowerCase();
  if (s.includes('sport')) return 'sports';
  if (s.includes('music') || s.includes('concert') || s.includes('festival')) return 'events';
  if (s.includes('arts') || s.includes('theatre') || s.includes('comedy') || s.includes('family')) return 'events';
  return 'events';
}

export function tmHeatScore(ev) {
  let score = 20;
  score += Math.max(0, 30 - ev._rank * 0.15);
  if      (ev._daysAway <= 1)  score += 30;
  else if (ev._daysAway <= 3)  score += 20;
  else if (ev._daysAway <= 7)  score += 12;
  else if (ev._daysAway <= 14) score += 6;
  if (ev.img) score += 5;
  return Math.min(Math.round(score), 100);
}

export function tmHeatLevel(score) {
  if (score >= 65) return 3;
  if (score >= 35) return 2;
  if (score >= 10) return 1;
  return 0;
}

export const TM_REGIONS = [
  {lat:35.0456, lng:-85.3096}, {lat:40.7128, lng:-74.0060},
  {lat:34.0522, lng:-118.2437},{lat:41.8781, lng:-87.6298},
  {lat:29.7604, lng:-95.3698}, {lat:33.4484, lng:-112.0740},
  {lat:47.6062, lng:-122.3321},{lat:39.9526, lng:-75.1652},
  {lat:25.7617, lng:-80.1918}, {lat:44.9778, lng:-93.2650},
  {lat:39.7392, lng:-104.9903},{lat:29.4241, lng:-98.4936},
];
