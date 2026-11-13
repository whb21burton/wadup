# Chattanooga and surrounding-area venue audit — 2026-11-13

## Completed live database checks
- Audited all **485** live venue records for category, subcategory, hiding, identifiers, websites, and coordinates.
- Category counts: 369 restaurant; 60 nightlife; 24 activities; 21 outdoors; 9 events; 2 sports-venue facilities.
- 9 hidden; 476 not hidden.
- 0 empty subcategory values.
- Normalized **all 369 restaurant primary subcategories** to one of the visible restaurant filters; retained legacy subcategory tags for context.
- Normalized arcade, escape-room, and active dance-club primary labels.
- Previous targeted corrections include Sing It or Wing It → Karaoke Bar; Dread Hollow → hidden seasonal event; reclassified museums, skating, climbing, family attractions, and selected park listings.

## Unresolved quality and coverage flags
- **246** live venue rows lack a Google Place ID. This does not prove they are invalid; no automatic deletion.
- **131** lack a website; public parks frequently do not have their own site.
- **4** lack coordinates and cannot reliably render as map pins.
- **2** exact lowercased name/address collision groups; inspect ownership and reviews before merging. Same-name different-address chains are legitimate locations.
- 2 sports facilities (Erlanger Park and Finley Stadium) remain venue records; sports *map filter* is intended to display dated Ticketmaster sports events rather than these static venues.
- The live venue dataset has **no pickleball-specific listings**, so the new pickleball filter will initially be empty until sourced.
- No imported disc-golf course directory or external user-review ratings. OSM candidate script committed but not run; licensing and operational status checks pending.
- The 321 pending venue candidates remain unapproved until deduplication and operational review.
- Missing/closed venues, public/private access, dog parks, court amenities, recurring specials, and real-time events cannot be verified from category metadata alone.
- GitHub PR #3 remains draft. Vercel preview compiled but failed because preview Supabase URL was missing; do not merge before an end-to-end map test.

## Safety rules
- Never collapse chain locations based solely on matching name.
- Never overwrite user ratings, owner corrections, or subscription content during dedupe.
- Only show 🐕 when a park's dog-park amenity is verified.
- Only advertise verified recurring specials/events with source and last-checked time.
- Do not invent ratings from UDisc/Birdied or represent golf course slope rating as user satisfaction.
- No paid Google Places discovery was invoked by this audit.

## Next operational verification
1. Review the four missing-coordinate venues and two exact name/address collisions.
2. Verify public/private access and current operation of all nonrestaurant activity/outdoor locations.
3. Confirm map preview env and test filter-to-pin behavior.
4. Import vetted public courts, pickleball, golf, disc golf, and dog-park locations from authorized data sources.
5. Verify missing Pin Strikes status before adding.
