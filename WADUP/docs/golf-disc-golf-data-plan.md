# Golf / disc golf data sourcing and rankings

## Safe discovery
- **OpenStreetMap**: discover `leisure=golf_course` and `leisure=disc_golf_course` without Google Places billing. Use `node scripts/discover-osm-courses.mjs` to create **review-only** candidates. Deduplicate by OSM element id and proximity/name before any insert. Do not call Overpass on every user page load. Honor OSM attribution and ODbL share-alike obligations; maintain source provenance and get legal review before mixing into a proprietary database.
- **PDGA**: authenticated course API exists, but free API is noncommercial; get explicit commercial permission and comply with attribution before importing into Wadup.
- **UDisc**: do not scrape, bulk download or copy ratings; UDisc terms prohibit commercial reuse without written consent. Request a licensed partnership/feed if UDisc rating integration is desired.
- **Birdied**: course locations originate from OSM; member-submitted reviews are not thereby OSM-licensed. Request a partnership for ratings.
- **GolfCoursesAPI**: free tier advertised at 30 requests/day, with $9.99/month and $19.99/month options. Confirm production/commercial rights, redistribution, quotas and caching terms before integration. It provides **course/slope ratings** (difficulty), not player review scores.

## Rankings
Use existing Wadup 1–10 weighted user ratings for both golf and disc golf. Rank by verified Wadup reviews once enough reviews exist; otherwise show a clearly labeled, licensed third-party rating only if approved, or mark **Unrated**. Never present course/slope rating as user satisfaction or manufacture scores. Distinguish public, private, seasonal and temporary courses. Allow users to contribute course access, holes, tees, fees, dog park presence and hours with moderation. Show course emoji ⛳ or 🥏.

## Open items before public launch
- Validate the OSM candidates against real course operations and access restrictions.
- Add clear OSM attribution where OSM-derived listings appear.
- Secure commercial licenses for any external review scores.
- Check the course importer and category UI in a real Next.js build.
- Confirm missing Chattanooga bowling venues' current operational status before insertion.
