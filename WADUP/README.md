# WadUp

Discover live events, nightlife, and sports near you in real time.

## Setup

1. **Clone / push to GitHub**
2. **Connect to Vercel** → New Project → Import repo
3. **Add Environment Variables** in Vercel dashboard:
   - `NEXT_PUBLIC_GMAPS_KEY` = your Google Maps API key
   - `TM_KEY` = your Ticketmaster API key
4. **Deploy** — Vercel auto-deploys on every push

## Local Development

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Stack

- **Next.js 14** — React framework
- **Google Maps JavaScript API** — interactive map
- **/api/tm** — Ticketmaster proxy (server-side, no CORS)
- **/api/geocode** — Google Geocoding proxy

## Key Files

- `pages/index.js` — main map app
- `pages/api/tm.js` — Ticketmaster API proxy
- `pages/api/geocode.js` — geocoding proxy
- `lib/data.js` — venue data + heat scoring logic
- `styles/globals.css` — all styles
