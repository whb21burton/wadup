#!/usr/bin/env node
// Read-only, no-cost discovery of golf and disc-golf courses via OpenStreetMap.
// Usage: node scripts/discover-osm-courses.mjs "34.75,-85.65,35.45,-84.75"
// Writes a reviewable JSON file; NEVER modifies Supabase or calls Google Places.
// OSM data © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
import fs from 'node:fs/promises';
const bounds = process.argv[2] || '34.75,-85.65,35.45,-84.75';
if (!/^-?\d{1,2}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?,-?\d{1,2}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/.test(bounds)) throw Error('Use south,west,north,east bbox');
const [south,west,north,east] = bounds.split(',').map(Number);
if (!(south<north && west<east && south>=-90 && north<=90 && west>=-180 && east<=180)) throw Error('Invalid bbox');
const query = `[out:json][timeout:35];(nwr["leisure"="golf_course"](${bounds});nwr["leisure"="disc_golf_course"](${bounds}););out center tags;`;
const controller = new AbortController();
const timeout = setTimeout(()=>controller.abort(),45000);
try {
  const response = await fetch('https://overpass.kumi.systems/api/interpreter', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({data:query}), signal:controller.signal
  });
  if (!response.ok) throw Error(`Overpass HTTP ${response.status}; retry later, do not hammer the public service`);
  const json = await response.json();
  const courses = (json.elements||[]).map(e=>({
    source:'openstreetmap', source_id:`${e.type}/${e.id}`,
    name:e.tags?.name||null, latitude:e.lat??e.center?.lat??null,
    longitude:e.lon??e.center?.lon??null,
    course_type:e.tags?.leisure==='disc_golf_course'?'disc_golf':'golf',
    access:e.tags?.access||null, website:e.tags?.website||null,
    holes:e.tags?.golf?.holes||e.tags?.holes||null,
    osm_tags:e.tags||{}, source_license:'ODbL',
    attribution:'© OpenStreetMap contributors',
    source_url:`https://www.openstreetmap.org/${e.type}/${e.id}`
  })).filter(e=>e.name&&e.latitude!=null&&e.longitude!=null);
  await fs.mkdir('data/course-candidates',{recursive:true});
  const file='data/course-candidates/osm-courses.json';
  await fs.writeFile(file,JSON.stringify({bounds,discovered_at:new Date().toISOString(),license:'ODbL',courses},null,2));
  console.log(`Found ${courses.length} named course candidates. Review ${file} before import. No DB writes.`);
} finally {clearTimeout(timeout);}
