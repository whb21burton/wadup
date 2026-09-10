// scripts/sync-now.js — triggers the live Chattanooga venue sync (pages/api/places/sync.js)
// from the terminal. Run with: node scripts/sync-now.js
const fs = require('fs');
const path = require('path');

// This script runs outside Next.js, so .env.local isn't auto-loaded — read it directly.
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^=#\s]+)=(.*)$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].trim();
  }
}

async function main() {
  if (!process.env.ADMIN_SYNC_PASSWORD) {
    console.error('ADMIN_SYNC_PASSWORD not found in .env.local');
    process.exit(1);
  }

  console.log('Starting Chattanooga nightlife (bar) sync...');

  const res = await fetch('https://www.wadup.app/api/places/sync?category=nightlife', {
    method: 'POST',
    headers: {
      'x-admin-password': process.env.ADMIN_SYNC_PASSWORD,
    },
  });

  const data = await res.json();
  console.log('Result:', JSON.stringify(data, null, 2));

  console.log('\nTriggering Ticketmaster events cache sync...');
  const tmRes = await fetch('https://www.wadup.app/api/cron/sync-tm-events', {
    method: 'GET',
    headers: { 'x-admin-password': process.env.ADMIN_SYNC_PASSWORD },
  });
  const tmData = await tmRes.json();
  console.log('TM Cache:', JSON.stringify(tmData, null, 2));
}

main().catch(console.error);
