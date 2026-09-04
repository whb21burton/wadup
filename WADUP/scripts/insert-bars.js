// scripts/insert-bars.js — inserts a manual list of Chattanooga bars directly
// into the live `venues` table via the Supabase service-role key, bypassing
// the venues_pending review queue that pages/api/places/sync.js normally
// requires for new venues. Run with: node scripts/insert-bars.js
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^=#\s]+)=(.*)$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].trim();
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const missingBars = [
  { name: 'Backstage Bar', category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0541, lng: -85.3098, google_rating: 4.5 },
  { name: "Reagan's Retro Bar", category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0537, lng: -85.3094, google_rating: 4.4 },
  { name: 'Westbound Honky-Tonk', category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0539, lng: -85.3091, google_rating: 4.3 },
  { name: 'The Boneyard', category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0536, lng: -85.3088, google_rating: 4.2 },
  { name: 'Wanderlinger Brewing Company', category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0545, lng: -85.3102, google_rating: 4.6 },
  { name: "Elsie's Daughter", category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0541, lng: -85.3075, google_rating: 4.5 },
  { name: 'Chattanooga Whiskey Experimental Distillery', category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0492, lng: -85.3123, google_rating: 4.7 },
  { name: 'Hair of the Dog', category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0488, lng: -85.3098, google_rating: 4.3 },
  { name: 'Honest Pint', category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0486, lng: -85.3087, google_rating: 4.4 },
  { name: 'Proof Bar', category: 'nightlife', categories: ['nightlife'], city: 'Chattanooga', state: 'TN', lat: 35.0495, lng: -85.3091, google_rating: 4.5 },
];

async function insertBars() {
  const { data, error } = await supabase
    .from('venues')
    .insert(missingBars.map(b => ({ ...b, source: 'manual', is_hidden: false })))
    .select();

  console.log('Inserted:', data);
  console.log('Error:', error);
}

insertBars();
