# WADUP experience restoration audit

## Comparison

Baseline is the live Vercel production site at `f068691`. The reported preview is `5da0d14`. Restoration is `e67dc93` on `development/official-event-integrations`. No changes were made to Production, hosted Supabase, billing approval or discovery settings.

| Area | Production to reported preview | Finding |
|---|---|---|
| Map startup | Production falls back to a browser key from old source. The reported preview requires a configured key and meters initialization. Neither the key nor the billing admission environment is configured for this preview. | The missing Preview key explains the exact error. Restoring it alone would reach the next budget gate. Keep the key out of source and gate before loading the Google script. |
| Desktop WADUP feed | The logo on production collapses and reopens Happening Today. On the reported preview the click reselects the same category and leaves the feed open. | Unintended regression independently reproduced against both hosted sites. Restored the exact production sidebar source. The old layout hash matched the regression. The corrected hash matches the verified production source exactly. |
| Desktop and mobile framing | Public stylesheet, public assets, account component, breakpoint layout and calendar markup match production. Calendar initialization now uses the browser's date after hydration. | Approved layout preserved. Hosted shell comparison verified the two sizes, visible account entry and seven days. |
| Categories | Coffee and Shopping appear in Preview. Pool Hall is present and Disc Golf is deferred. Event filtering retains Sports, Music, Theater, Comedy and Festivals & Markets. | Changes documented in the owner's directives. The category menu still selects on first click and toggles subcategories on subsequent desktop clicks. |
| Must-See | Both builds retain the menu entry conditional on qualifying venues in the viewport. With no initialized map the condition never becomes true. | The code path exists. Actual category visibility around qualifying attractions still needs the live map. |
| Restaurant and bar pins | Medal css colors, ranking function and visible-viewport ranking remain unchanged. Marker reuse and geographic filtering were added. The 12% hover scale is authorized. A hovered restaurant or bar used a higher stack level than a selected marker. | Restored selected-over-hover precedence while retaining unified emoji, label and arrow and existing medal styling. Real renders still require Maps. |
| Event marker overlaps | Production checked rendered pin rectangles at zoom 17 and above. The reported preview limited staggering to geographic groups within roughly 12 meters, which ignores visibly overlapping labels from separate venues. | Restored screen-space overlap handling at the existing zoom threshold with batched geometry reads, while keeping canonical venue coordinates, map idle scheduling, and showtime ordering. |
| Event contents | Canonical venue locations, selected-day cache reads, official venue reconciliation, exact showtime links, affiliate handling, source/fallback labels, and event-specific emojis differ by approved event work. Songbirds has shared hover and click ticket contents. | Preserve. Ticket/provider safeguards and backend integrations remain on the branch. Production-read event availability cannot establish Preview feeds without staged credentials and a live map. |
| Data-dependent map behavior | Preview reuses pins, loads geographic data as the map settles and invalidates event cache on date changes. An optional vector experiment has no effect at the default URL. | Keep the approved performance work. Live zoom, pan, marker rendering, dense overlap, rankings and purchase-button interactions remain unverified in this comparison. |
| Admin and profile | Additional venue categories in the admin editor were scoped to the three owner-approved categories. Nonvisual contact privacy applies explicit field reads on the development branch. | No profile layout changes. No new profile features were developed during the restoration. |
| Legacy Google and backend | Removed page-load Places auto-sync, isolated official collection and Ticketmaster credentials, kept billing/discovery disabled when data is missing, and added authorized administration diagnostics. | Keep these safeguards. They are outside the public visual restoration. |

## Preview variables and their exact scopes

This is a names-only Vercel metadata audit. It does not assume a key is valid based on a variable name.

| Variable | Latest development Preview status |
|---|---|
| `NEXT_PUBLIC_GMAPS_KEY` | Absent. Required at build for Google Maps JavaScript. No fallback key in the development branch. |
| `GOOGLE_METERED_REQUESTS_VERIFIED` | Absent. Intended to remain off until accounted capacity is verified. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | General Preview entries exist. An isolated Supabase target and matching public key are needed for a safe full preview that exercises reservations and event reads. |
| `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | Sensitive entries belong only to the older `map-performance-preview` branch. Use the isolated Preview service key for the reservation ledger. Cron is separate from map display. |
| `GOOGLE_USAGE_BILLING_ACCOUNT`, `GOOGLE_USAGE_FEED_SECRET` | Absent. Set only on the approved isolated usage-report receiver with the matching producer secret and verified scope. |
| `NEXT_PUBLIC_APP_URL` | Present in Production only. Vercel provides the Preview hostname. |
| `TM_KEY` | Absent. Required for refreshing Ticketmaster from its provider, while reading an existing isolated cache does not need it. |
| `VENUE_SYNC_ENABLED`, `TICKET_VERIFY_ENABLED` | Older Preview branch only. Keep hosted writes off until the isolated target and permissions are separately approved. |
| `VENUE_SYNC_VERIFY_SECRET` | Present on this branch for the non-writing official-calendar verifier. |
| `GMAPS_KEY` | Absent. This server-side geocoding key is separate from Maps JavaScript and not required to display the map. |
| `GOOGLE_PLACES_KEY`, `ADMIN_SYNC_PASSWORD`, `ANTHROPIC_API_KEY` | Present in Preview and Production. They do not configure Maps JavaScript. |
| `GOOGLE_PLACES_FREE_BUDGET_VERIFIED`, `GOOGLE_DISCOVERY_KEY`, `GOOGLE_DISCOVERY_REGION` or `GOOGLE_DISCOVERY_REGIONS` | Discovery configuration remains disabled. It is independent of the browser map. |

## Preview Maps key setup

Ordinary map rendering on development commit `317d725` uses `NEXT_PUBLIC_GMAPS_KEY` directly. There is no map-session endpoint, window, billing report prerequisite, additional Google Cloud project, or additional Supabase project. The previous time-boxed setup has been removed.

1. In Google Cloud project `project-24f94cff-cf36-4269-940`, open **Google Maps Platform → Keys & Credentials**. Create a browser key restricted to **Maps JavaScript API** and **Websites**. Add `https://whb21burton-wadup-git-development-b85c4d-whb21burtons-projects.vercel.app` and `https://whb21burton-wadup-git-development-b85c4d-whb21burtons-projects.vercel.app/*`. Both entries cover the same stable preview host.
2. In **Vercel → whb21burtons-projects → whb21burton-wadup → Settings → Environment Variables**, add `NEXT_PUBLIC_GMAPS_KEY` using this browser key. Select **Preview** and scope it to **development/official-event-integrations**. Do not set any Maps window variable or use a server or production key.
3. Redeploy that Preview so Next.js receives the variable at build time, and open the stable protected branch address. The key may be sent to Google by a browser by design. Keep its value out of chat and source. The Maps URL restrictions, Vercel Authentication, billing monitoring, and the bulk discovery gate remain in place.

All map-session and test-window code was removed. Billing monitoring and discovery still have independent settings and behavior. There were no production deployments, hosted migrations, or profile feature changes.

Sources: [Google Maps browser key setup](https://developers.google.com/maps/documentation/javascript/get-api-key) · [Vercel Preview variables](https://vercel.com/docs/environment-variables).

## Evidence

The screenshots show the real hosted HTML and CSS at 1440×900 and 390×844. Outbound Google traffic was blocked to avoid a billable load. They compare the interface only. The production download warning is caused by that block, while the Preview key warning occurs before any Google request. The maps, pins and checkout flows remain unverified on actual Google Maps.

The browser shell comparison confirmed the calendar, login controls and desktop category toggles on both hosted sites. The reported Preview lacked the desktop WADUP feed toggle. Source comparison confirmed the restored sidebar matches production exactly. All 27 event and budget tests and both owner layout/category checks passed. The map guard still fails closed without the explicit configuration and fresh usage data.

Sources: [Google Maps key restrictions](https://developers.google.com/maps/documentation/javascript/get-api-key) · [Google Maps billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing) · [Vercel environment variables](https://vercel.com/docs/environment-variables).

### Final verification on protected preview `2e6b939`

The latest preview built successfully. Compared the production and reported-preview shells, then checked the restored preview at 1440×900 and 390×844. The desktop WADUP feed control collapsed on production and the restored preview, and did not collapse on the reported preview. The desktop category menu expanded and collapsed, and account controls opened at both sizes. The seven-day calendar and approved layout/category checks passed. No Maps traffic was sent in these captures. An isolated startup test with an inert key verified that a denied reservation produced one refused application request and no Google Maps requests. Read-only Supabase inspection found 10 visible Must-See listings in the Chattanooga area. Their live visibility and all map-dependent interactions remain unverified pending the secure setup above.

- Desktop [production](<C:/Users/whb21/.codex/visualizations/2026/11/24/01a20e6b-62c5-79e3-8e4a-9de2e8c88990/wadup-ui-audit/production-desktop.png>), [reported preview](<C:/Users/whb21/.codex/visualizations/2026/11/24/01a20e6b-62c5-79e3-8e4a-9de2e8c88990/wadup-ui-audit/preview-before-desktop.png>) and [restored preview](<C:/Users/whb21/.codex/visualizations/2026/11/24/01a20e6b-62c5-79e3-8e4a-9de2e8c88990/wadup-ui-audit/preview-after-desktop.png>)
- Mobile [production](<C:/Users/whb21/.codex/visualizations/2026/11/24/01a20e6b-62c5-79e3-8e4a-9de2e8c88990/wadup-ui-audit/production-mobile.png>), [reported preview](<C:/Users/whb21/.codex/visualizations/2026/11/24/01a20e6b-62c5-79e3-8e4a-9de2e8c88990/wadup-ui-audit/preview-before-mobile.png>) and [restored preview](<C:/Users/whb21/.codex/visualizations/2026/11/24/01a20e6b-62c5-79e3-8e4a-9de2e8c88990/wadup-ui-audit/preview-after-mobile.png>)

## Live production baseline

With normal Maps usage authorized, the production site served the real Google basemap and ten ranked restaurant pins on both desktop and mobile in Chattanooga at zoom 15. One Maps JavaScript startup per viewport was used. WADUP and Supabase writes were blocked, and no bulk discovery was invoked. I exercised a short pan and zoom and opened the existing account panel. This records production behavior for comparison. The Preview equivalents and the event pin/showtime checks still await the restricted Preview key.

- [Desktop live baseline](<C:/Users/whb21/.codex/visualizations/2026/11/24/01a20e6b-62c5-79e3-8e4a-9de2e8c88990/wadup-live-maps/production-live-desktop.png>)
- [Mobile live baseline](<C:/Users/whb21/.codex/visualizations/2026/11/24/01a20e6b-62c5-79e3-8e4a-9de2e8c88990/wadup-live-maps/production-live-mobile.png>)
