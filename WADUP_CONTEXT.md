# WADUP — Project Handover

Create a permanent WADUP_CONTEXT.md file in the Git root using the following information. Update TASKS.md with the outstanding development work. Preserve the existing AGENTS.md instructions.

## 1. Product vision

WADUP.app is a nationwide, map-first discovery platform that helps people find the best places to go and discover what is happening around them.

Chattanooga is the initial market, but the application must scale nationwide without requiring manual redevelopment for each city.

The existing application must be preserved. Do not redesign it or replace working components.

## 2. Infrastructure

- GitHub: whb21burton/wadup
- Production: https://www.wadup.app
- Hosting: Vercel
- Database: Supabase
- Maps and venue discovery: Google Maps and Google Places
- Events: Ticketmaster and official venue websites
- Existing application directory: WADUP/

## 3. Permanent design requirements

- Make specific, surgical changes rather than redesigning the application.
- Preserve existing colors, fonts, layouts, spacing and sidebar behavior.
- Map pins must behave as unified elements.
- The emoji, name and arrow must remain together.
- Hovering or clicking any portion of a pin must bring the entire pin to the foreground.
- Preserve existing zoom behavior.
- Stagger overlapping events at neighborhood-level zoom.
- Avoid unnecessary code, duplicate functions and speculative fixes.

## 4. Main categories

- Restaurants
- Bars & Nightlife
- Activities
- Outdoors
- Coffee
- Shopping
- Events
- Must-See

Preserve the established category taxonomy. Do not invent additional categories without authorization.

### Restaurants

Allow local restaurants and eligible sit-down chains. Exclude conventional drive-through fast-food chains and standalone ice cream shops.

Preserve existing cuisine subcategories. Italian and Greek are combined.

Rank restaurants within the visible map area and selected subcategory. Highlight the top three using gold, silver and bronze.

Super-admin ranking adjustments count as ten user reviews. Over time, genuine user ratings should determine rankings.

### Bars & Nightlife

Preserve Karaoke, Dance/Club, Speakeasy, Dive Bar, Sports Bar and Pool Hall.

Live music is an event or venue attribute, not a separate bar subcategory. Wine Bar and Cocktail Bar were removed.

### Activities

Include escape rooms, arcades, bowling, trampoline parks, miniature golf, axe throwing, golf entertainment, pickleball and similar activities.

### Outdoors

Include parks, trails, dog parks, climbing, kayaking, paddle rentals and eligible outdoor shops. Preserve the dog park emoji. Disc golf was deferred.

### Coffee

Local and Chain are the two filters. Exclude gas stations and convenience stores.

### Shopping

Focus on boutiques, local shops, vintage stores, markets and malls. Exclude big-box stores, drugstores, dollar stores and gas stations.

### Must-See

Include significant destination attractions such as Rock City, Ruby Falls and the Tennessee Aquarium.

Only display this category when qualifying locations exist within the map viewport.

## 5. Events requirements

Events is a map-first, time-based discovery category.

The user should immediately see events on the map when selecting Events.

Subcategories, in order:

1. Sports
2. Music
3. Theater
4. Comedy
5. Festivals & Markets

Community was removed.

- Preserve the seven-day quick selector and calendar.
- Display events corresponding to the selected date.
- Use event-specific emojis.
- Music events default to the music note emoji.
- Sports should use the corresponding sport emoji.
- Multiple showings of the same event should appear in one event profile.
- Every individual showtime must have its corresponding Get Tickets link.
- Never display invented event times.
- Never send customers to an unrelated ticket purchase page.
- Prevent duplicates between Ticketmaster and venue website events.

Happy hours and ongoing promotions belong in venue profiles, not the main Events feed.

## 6. Event sourcing strategy

Use official venue websites to establish accurate event information when accessible.

Prefer the corresponding Ticketmaster purchase link when an exact event match is available. Otherwise use the official event or venue ticket link.

If a venue website cannot be scraped reliably, use Ticketmaster as the primary source when coverage exists.

Do not fabricate missing dates, times, prices or links.

Maintain automatic refresh, source provenance, deduplication and expiration of outdated events.

## 7. Immediate outstanding development jobs

These are reported pending items from the previous ChatGPT development sessions. Verify their actual implementation status before changing code.

### Priority 1 — Songbirds

- Update the official venue website to https://venue.songbirds.org.
- Correct the issue where events were consistently displayed at 8 PM regardless of their actual start time.
- Retrieve accurate individual event times.
- Add corresponding official ticket purchase links.
- Verify automatic synchronization.

### Priority 2 — Remaining venue integrations

Audit and finish all venues in the existing event registry, including:

- The Signal
- Songbirds
- Alliance Theatre
- Fox Theatre
- Tivoli Theatre
- Walker Theatre
- Tabernacle
- The Eastern

Previous ChatGPT work reported importing 26 official performances for The Signal through May 24, 2027, and correcting its venue ID. Verify this before importing anything again.

Tivoli and Walker may share a calendar. Preserve correct venue attribution.

Tabernacle and The Eastern previously encountered accessibility problems. Use Ticketmaster fallback when official website ingestion is unavailable.

Continue through the entire venue registry, not just the venues listed above.

### Priority 3 — Ticket reconciliation

- Match official venue events with Ticketmaster events.
- Prevent duplicate performances.
- Preserve different showtimes.
- Verify event dates, time zones and ticket links.
- Verify the latest change that displays Ticketmaster showtimes for the selected calendar date.

### Priority 4 — Automatic synchronization

Ensure venue schedules refresh automatically, including new performances, cancellations, changed times and expired events.

Audit existing scheduled jobs before creating new ones.

### Priority 5 — Regression testing

Verify that event work has not broken existing restaurant rankings, category filters, map pins, venue profiles or responsive layouts.

Use existing GitHub category and layout checks.

Confirm the actual production deployment commit through Vercel when permissions allow.

## 8. API spending restrictions

The objective is to populate WADUP nationwide while minimizing API expenses.

Google Places discovery must not incur unauthorized charges.

The previous working target was approximately 4,500 monthly discovery requests with a reserve of 500, subject to the actual current API SKU pricing and verified usage.

Do not assume these limits remain valid without checking the applicable SKU.

Use budget enforcement, caching, geographic queues and controlled request limits.

Previous work reported 792 geographic tiles queued and a missing authoritative Google billing snapshot. Verify current status before resuming automated Google Places discovery.

Google Cloud budget alerts are not hard spending caps.

Do not activate paid discovery or increase spending without authorization.

## 9. Future business model

These are roadmap items, not authorization to implement immediately.

- Nationwide user-driven venue rankings.
- Ticketmaster affiliate revenue.
- Paid business-owner subscriptions.
- Verified business owners can manage venue information, events, schedules, happy hours and promotions.
- Free venue listings remain available.
- User participation incentives and rewards.

Accuracy, verification and expiration of business promotions are essential.

## 10. Execution rules

Work through the authorized development backlog without requiring repeated instructions.

Before implementing:

- Inspect existing code and recent Git history.
- Determine which jobs are already completed.
- Do not repeat work unnecessarily.
- Maintain TASKS.md as the persistent source of task status.
- Document completed changes and verification results.

Implement and test each outstanding event integration.

If one venue is blocked, record the reason and continue working on the others.

Use a development branch and preview deployments. Do not merge to production or make destructive production database changes without authorization.

Do not expose credentials, API keys or private business information in repository documentation.

Begin executing the outstanding event development jobs after recording this handover. Do not stop after simply creating the documentation.

## 11. Staging, credentials and release preflight

WADUP's hosted Supabase organization is Pro. Its only WADUP database is production. The workstation has no Docker-compatible runtime or WSL, and Supabase's container-free CLI runtime does not support Windows. Use the isolated PostgreSQL fixture for worker and schedule API verification. Use a full local Supabase stack or a separate, confirmed Free project for Auth, protected writes and preview account tests. Seed test users and data. Keep production data and production service-role credentials out of preview. No paid branch, recurring expense, or paid API call is authorized.

The two owner actions for Vercel are independent. In the preview browser, choose **Log in to Vercel** and sign in as a member of `whb21burtons-projects`. In PowerShell run `vercel.cmd login` and approve the device request in the browser after checking its account, time and location. Keep the displayed code in the Vercel flow. `vercel.cmd whoami` should identify the expected account. The existing CLI token was rejected and this checkout has no Vercel project link. After renewal, link only to `whb21burton-wadup` under `whb21burtons-projects` and use the same project's short-lived Development OIDC credential for protected Playwright requests. The preview protection stays enabled.

Use **Vercel → whb21burtons-projects → whb21burton-wadup → Settings → Environment Variables**. For Preview, select the `development/official-event-integrations` branch when setting staging-specific values. The November audit showed the following configuration gaps. Never paste the values into chat.

| Name | Purpose | Required scope |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database writes and protected admin operations | Production project credential in Production. Separate staging credential in branch Preview. Currently scoped only to the old preview branch. |
| `CRON_SECRET` | Authenticates scheduled and manually invoked worker requests | Separate sensitive values for Production and branch Preview. Currently scoped only to the old preview branch. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Supabase connection and Auth | Already exist by environment. Override both with the same isolated project on the development Preview branch. The service-role credential must never use a public name. |
| `NEXT_PUBLIC_GMAPS_KEY` | Maps JavaScript in browsers | Production website-restricted Maps JavaScript key and a separate key limited to the exact approved preview origin. Add only after budget safeguards and live usage are authorized. |
| `GMAPS_KEY` | Server geocoding | Separate sensitive Geocoding-only key in environments authorized to issue those requests. |
| `TM_KEY` | Ticketmaster Discovery cache refresh and proxy | Replacement sensitive key in Production and branch Preview when live Ticketmaster testing is authorized. |
| `VENUE_SYNC_ENABLED`, `TICKET_VERIFY_ENABLED` | Enable official ingestion and ticket verification | Set to `1` on the isolated branch Preview after the migration and runtime permissions are verified. Set Production values only as part of the approved release. Currently configured only for the old preview branch. |
| `GOOGLE_PLACES_FREE_BUDGET_VERIFIED` | Attests that discovery's account and SKU safeguards have been verified | Leave unset until the authoritative report, Google quotas, and approved release are ready. |
| `NEXT_PUBLIC_TM_AFFILIATE_ID` | Optional explicit affiliate account setting | Public configuration for Production and Preview. The existing default continues to apply when unset. |

`ADMIN_SYNC_PASSWORD`, `GOOGLE_PLACES_KEY` and `ANTHROPIC_API_KEY` already have Production and Preview entries. Avoid using the latter two during staging. Rotate the historical Ticketmaster and Google keys with their providers. Use a browser key restricted by website and Maps JavaScript API, a separate server key restricted to Geocoding, and a separate discovery key restricted to Places API (New). Current code requires configuration instead of falling back to the historical keys. Retire the old credentials after validating the replacement on approved environments. Confirm that restoring the old deployment will still serve the map and events. If old credentials have already been revoked, keep a build of the previous application code with replacement configuration as the rollback target.

For the additive event schema, apply `official-venue-schedules.sql`, `official-venue-access.sql` and `official-venue-snapshots.sql` in that order to an isolated database. Review `places-discovery-reservation.sql` separately on a clone of the discovery table schema. The changes keep old columns and rows and limit the new RPCs to `service_role`. A rollback restores the application and disables new workers while retaining the additive database objects. Keep discovery paused after a rollback until the restored code's spending controls are verified.

## 12. Discovery audit and free-usage accounting

The November 25 audit found 22 recorded Nearby Search reservations and one quota-blocked run, 789 untouched tiles, one tile six of eight categories through, and two completed tiles. At eight searches per full tile, 22 requests exactly account for that progress. The configured worker runs at most eight times a day on a three-hour schedule. There is no authoritative billing snapshot in the connected database.

Current code paths and published global pay-as-you-go free allowances per billing account per month are listed below. Verify the account's pricing and current usage before activation. Google charges by the highest field tier requested.

| Call | SKU | Free allowance |
|---|---|---:|
| Maps JavaScript map load | Dynamic Maps | 10,000 |
| Server geocoding and reverse geocoding | Geocoding | 10,000 |
| Discovery-only Nearby Search field mask | Nearby Search Pro | 5,000 |
| Legacy enriched Nearby Search with phone, hours and ratings | Nearby Search Enterprise | 1,000 |
| Admin Text Search with phone, hours and ratings | Text Search Enterprise | 1,000 |
| Legacy Place Details with reviews | Place Details Enterprise + Atmosphere | 1,000 |
| Photo media retrieval | Place Details Photos | 1,000 |

The separate admin monitoring endpoint uses Cloud Monitoring API reads. Its published free allotment is one million time series returned per billing account per month. Console-issued reads have separate no-charge treatment. The endpoint also exchanges a Vercel OIDC token using Google STS and impersonates a monitoring service account using IAM Credentials. Those are authentication calls with separate quotas. Leave automated polling off while its account usage is unknown. [Cloud Monitoring pricing](https://cloud.google.com/products/observability/pricing) · [IAM and STS quotas](https://docs.cloud.google.com/iam/quotas)

To obtain a no-request-cost snapshot, open **Google Cloud Console → Billing → the billing account linked to Maps → Reports**, select **Charge period** and the current Pacific calendar month, clear project filters, and group and filter by SKU. Check the usage total for **Places API Nearby Search Pro** (`99F9-A108-83A6`), including any usage credited as free. If Reports only exposes costs, use the billing account's usage details or an existing standard billing export for the billable-event count. Keep the report private. The existing read-only Cloud Monitoring endpoint measures project request counts and cannot certify billing-account SKU usage. Billing exports can lag, and BigQuery storage and queries may have costs, so leave new billing exports unconfigured while paid services are prohibited.

`google_api_budget_snapshots.captured_at` means the verified coverage cutoff of the billing data. Do not substitute the time the report was opened. Enter the Pacific `YYYY-MM` in the legacy `month_utc` field. The reservation RPC stops without an eligible snapshot and adds subsequent local reservations conservatively. With the authorized flag and a fresh verified snapshot, the next scheduled run can resume automatically. It claims and reserves one request atomically, stops at the 4,500 account target, and retains the eight-per-day and 250-per-month worker ceilings. Keep other clients' usage in the same billing-account budget and use provider quotas as an additional boundary. The 15-minute cadence remains deferred while the verified free budget is unavailable.

Sources: [Supabase local development](https://supabase.com/docs/guides/local-development), [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Vercel device login](https://vercel.com/changelog/new-vercel-cli-login-flow), [Google Maps SKU prices](https://developers.google.com/maps/billing-and-pricing/pricing), [Places field tiers](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing), [Cloud Billing reports](https://docs.cloud.google.com/billing/docs/how-to/reports).

## 13. Automated Google usage feed and venue data policy

The new receiver verifies a five-minute HMAC envelope against the raw request and requires a current Pacific-month billing-account report with explicit counts for every tracked SKU. It stores an immutable batch and treats duplicate batch IDs idempotently. The ledger uses a monthly high-water count, adds WADUP reservations after the reporting cutoff, counts outstanding discovery jobs conservatively, and keeps 10% of each published free allowance in reserve. A feed stops admitting requests if its receive time is six hours old or its source cutoff is 72 hours old. A valid report can restore eligibility on the next run. The database also serializes budget acquisition, so a retry counts even when the original request times out. The CSS and admin source use the same site layout, with per-SKU counters added under Restaurant Coverage.

The producer and publisher in `WADUP/scripts/` can run unattended against an **existing, explicitly approved Standard Cloud Billing export**. The optional BigQuery producer requires `GOOGLE_USAGE_EXPORT_TABLE`, `GOOGLE_USAGE_QUERY_PROJECT`, `GOOGLE_USAGE_QUERY_MAX_BYTES`, `GOOGLE_USAGE_BILLING_ACCOUNT`, and `GOOGLE_USAGE_QUERY_APPROVED=true`. Give the job identity dataset read access and permission to run jobs in the approved query project, with a bounded daily query quota. Use a secret manager for the shared `GOOGLE_USAGE_FEED_SECRET` and set `GOOGLE_USAGE_RECEIVER` to the exact HTTPS receiver URL. After cost approval and isolated verification, the existing job can run `node scripts/read-google-billing-export.mjs --query | node scripts/publish-google-usage.mjs - --send`. Without `--query` or `--send` respectively the scripts perform no external request. No export was created, queried, or scheduled in this work.

The producer uses a 48-hour reporting buffer and rejects stale exports and incompatible billing units. Google does not promise that a report is complete by that cutoff. The budget gate is therefore one layer of protection. Before enabling any paid-capable Google request, verify an account-wide, per-method/provider quota envelope and account for other projects using the same allowance. In particular, require a dedicated API-restricted `GOOGLE_DISCOVERY_KEY` and configure one exact `GOOGLE_DISCOVERY_REGION`. The live region currently contains 792 Chattanooga-area tiles. Keep `GOOGLE_PLACES_FREE_BUDGET_VERIFIED` and `GOOGLE_METERED_REQUESTS_VERIFIED` off until those controls and source freshness have been verified. `GOOGLE_MONITORING_READS_APPROVED` separately gates the old project-level Monitoring endpoint, which cannot establish SKU-wide billing headroom. A $0 cost total does not report actual units consumed.

Apply `WADUP/sql/google-usage-feed.sql` before `WADUP/sql/places-discovery-reservation.sql` in an isolated database. The changes are additive. Discovery searches one category per three-hour run, keeps daily and monthly local ceilings, and holds a failed category for six hours before retrying. An abandoned run keeps its reservation. The worker claims one configured region, prioritizes Chattanooga-area tiles nearest the established center, and requires a deliberate region change for expansion. It saves Place IDs only and does not publish or recategorize venues. These identifiers still need independently sourced names, addresses, coordinates and verification before a listing is created.

The production audit found 311 `google_places` venues, with 239 Google ratings and no nonempty `google_reviews` on those rows at the time checked. Existing paths can store Google place metadata, review content and photo references, often without field-level provenance or expiry. Google exempts Place IDs from its storage restriction. Coordinates may be temporarily cached only where the applicable service terms grant that exception, generally up to 30 consecutive days. Do not treat Google names, addresses, ratings, reviews or photo references as a permanent venue dataset. Google attribution must remain visible. Reviews and photos need the applicable author attribution alongside their content. The old photo proxy cached responses publicly and the review writer and renderer used different author fields. This branch removes new cache headers, separates discovery IDs, and keeps the legacy import, text-search and photo paths disabled behind `GOOGLE_LEGACY_CONTENT_APPROVED`. Before enabling those paths, verify the contract and ship attribution and retention handling for any returned content. Existing rows were audited read-only. Independently sourced venue fields, owner content and WADUP reviews need their own provenance and must not be conflated with Google fields. [Places storage and attribution policy](https://developers.google.com/maps/documentation/places/web-service/policies) · [Places field pricing](https://developers.google.com/maps/documentation/places/web-service/data-fields) · [Cloud Billing export limitations](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage)

The authenticated Vercel shell test uses the linked project's short-lived identity and blocks Google and production writes. `WADUP/tests/browser-scenarios.mjs` also provides `live-map` and `local-auth` modes. Set `WADUP_PLAYWRIGHT_ENTRY` to the absolute path to `playwright-core/index.mjs`, `WADUP_BROWSER_URL` to the protected preview or loopback application, and `WADUP_BROWSER_FIXTURES` to a local JSON file. Live map fixtures use `cities` entries with `name`, `lat`, `lng`, `zoom`, `date`, `event` and `showtimes`, plus optional `emoji`, `otherDayNumber`, `maxP95FrameMs` and `rankNames`. The `live-map` mode also requires verified budget approval. `local-auth` requires a loopback Supabase URL, a disposable loopback app, `WADUP_LOCAL_AUTH_ISOLATED=true`, local signup auto-confirm, and a seeded `venueId` and `venueName`. No separate hosted database is required to verify registration, sign-in and review writes on a full local Supabase. Hosted staging is needed only to validate those writes with the deployed Vercel app and its real hosted Auth, environment scopes or scheduled jobs.

### Scheduled reporting setup after approval

The GitHub workflow is configured for every two hours, at minute 17 UTC, and permits an on-demand run. The job requires the default `main` branch and a repository-level `GOOGLE_USAGE_QUERY_APPROVED=true` variable. Leave that variable unset until an existing Standard Cloud Billing export and the GitHub runner and BigQuery cost envelopes are verified. The worker remains paused if the reporting job fails or becomes stale.

1. In **Google Cloud Console → Billing → Billing export**, check whether Standard usage cost export already has a destination. A rolling spend total cannot establish this. Leave export setup untouched if no destination exists. Confirm the existing export covers the billing account and verify recurring query cost, daily quota and bytes limit before approval.
2. In **Google Cloud Console → IAM & Admin → Workload Identity Federation**, restrict the provider to the WADUP repository's numeric ID, `refs/heads/main`, and this workflow's identity. Grant the job's service account permission to read only the export dataset and create jobs only in the designated query project. Grant the restricted federated identity permission to use that service account. The workflow uses short-lived credentials.
3. In **GitHub → whb21burton/wadup → Settings → Environments**, configure `google-usage-reporting` with main as its allowed deployment branch. Store `GOOGLE_USAGE_OIDC_PROVIDER`, `GOOGLE_USAGE_REPORTER_SERVICE_ACCOUNT`, `GOOGLE_USAGE_BILLING_ACCOUNT`, `GOOGLE_USAGE_EXPORT_TABLE`, `GOOGLE_USAGE_QUERY_PROJECT`, `GOOGLE_USAGE_QUERY_MAX_BYTES` and `GOOGLE_USAGE_RECEIVER` as environment variables and `GOOGLE_USAGE_FEED_SECRET` as an environment secret. In the approved Vercel environment, configure the matching billing account and feed secret for the HTTPS receiver. Keep these values within provider settings. Set the repository-level approval variable in **GitHub → Settings → Secrets and variables → Actions → Variables** only after the release and cost verification.
4. Confirm the first scheduled report in **GitHub → Actions → Google API usage reporting** and verify that each SKU appears in Restaurant Coverage. Verify provider quotas, billing-account headroom and all other request sources independently before enabling discovery or Maps. The existing pause stays in place until those checks pass.

Sources: [Google federation setup](https://github.com/google-github-actions/auth#setup), [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Vercel CLI identity and project linking were restored. On November 25, preview commit `1960a0c` passed the authenticated desktop and mobile shell scenarios with all Google traffic blocked. The eight official calendars also passed the isolated event flow with 490 performances, including all 252 from Alliance. Current live-Maps and full Auth browser checks remain pending verified Google usage and a local Docker-compatible runtime, respectively.

## 14. Fifteen-minute discovery and the US billing export

The Vercel account reports Pro. The development branch sets `/api/cron/restaurant-coverage` to `*/15 * * * *`. Vercel schedules crons against production releases. The protected preview verifies the code without changing the active production schedule. Verify current Function usage and headroom before approval because cron invocations count toward Function usage.

Google's global Nearby Search Pro SKU `99F9-A108-83A6` includes 5,000 searches per month. WADUP caps its own reservations at 4,500 searches, subtracts reported account-wide usage and unabsorbed WADUP reservations, and preserves at least 500 searches as a 10% reserve. Each 15-minute slot can reserve two searches across overlapping invocations. That is eight per hour or 192 per 24-hour day at full pace. Sustaining 4,500 over a 28–31 day month averages about 6.0–6.7 searches per hour and 145–161 per day. These are planning rates assuming no competing use. Eight successful category searches complete a tile, so 4,500 searches cover up to 562 complete tiles and four categories of another. Chattanooga's 790 queued tiles need 6,314 successful category searches given the third tile's six already searched categories. That is at least two billing months with full headroom, before retries, outages, or sparse completed slots. Verify the account pricing and other consumers before activation. The catalog also corrected Place Details Enterprise + Atmosphere to `EB23-5ECC-F753`.

The first approved region is Chattanooga and its surrounding area. Set `GOOGLE_DISCOVERY_REGIONS` to an ordered JSON array of objects with exact table region names and numeric `lat` and `lng` centers. For existing configuration, `GOOGLE_DISCOVERY_REGION` still selects one Chattanooga-centered region. The worker prioritizes its nearest tile, continues its category cursor, waits for unfinished retry tiles, and selects the next explicitly configured region after earlier tiles finish. A six-hour per-tile retry is preserved. HTTP 401, 403, and 429 also pause new searches globally for one hour. Claims still reserve before Google and count failed or timed-out requests. No regions were seeded or advanced in hosted Supabase. For new cities, review geographic extent, seed isolated fixtures and approve the region bounds before applying seed data.

### Connect and verify the export

The owner enabled Standard usage cost export for `wadup_billing` in the US multi-region. The producer now checks that location, the exact Standard export table, matching billing account suffix, and metadata for storage size and expiry. It rounds its 48-hour reporting cutoff to a complete usage hour and rejects exports whose newest actual usage has yet to reach that cutoff or whose last export is over 24 hours old. Google can take up to five days for the first US backfill. This is a conservative readiness signal. It does not prove all services have delivered every row.

1. In **Google Cloud Console → Billing → Billing export → Standard usage cost**, confirm the linked project and dataset. In **BigQuery → Explorer → that project → wadup_billing**, open the Standard export table and inspect Details for US, logical bytes, recent data updates, and absence of table and partition expiration. Google advises leaving expiry off because deleted exported rows cannot be backfilled. Check account-wide storage in Billing, with a target below 8 GiB against the 10 GiB monthly free tier. This script stops at 8 GiB for its own table but cannot limit the separate automatic export or other datasets. Inspect growth and use a low-cost threshold alert, which does not cap spending.
2. Use the existing approved on-demand query project. In **IAM & Admin → Workload Identity Federation**, restrict the GitHub principal to the numeric repository ID, main ref, and usage-report workflow. Use dataset-scoped BigQuery Data Viewer and project-scoped BigQuery Job User. In **IAM & Admin → Quotas & System Limits**, check BigQuery's query usage per project and per user settings. Use a 12 GiB daily envelope for the dedicated reporting identity and track the remaining account-wide allowance. The 1 GiB per-query ceiling and two-hour cadence bound ordinary scheduled use to at most 372 GiB in a 31-day month, leaving 652 GiB of the published 1 TiB account free-tier allowance for other queries. Keep manual reruns and other projects within that balance.
3. Configure the GitHub and Vercel variables from section 13. Use the fully qualified export table for `GOOGLE_USAGE_EXPORT_TABLE` and the existing on-demand project for `GOOGLE_USAGE_QUERY_PROJECT`. With the reporting identity, run `node scripts/read-google-billing-export.mjs --preflight` inside `WADUP`. This uses table metadata and a BigQuery dry run, with no query charge. Confirm the byte estimate is within 1 GiB and inspect static schema and usage units. A real bounded query may run only after verifying account headroom and access. Compare the first SKU rows to Billing grouped by SKU, including usage covered by the free tier. Keep `GOOGLE_PLACES_FREE_BUDGET_VERIFIED` unset until the matched reports, provider limits, and isolated migration are verified.
4. Verify the protected preview, SQL and current production Vercel scopes before requesting release approval. Apply the additive SQL in the order documented above after approval. Deploy with discovery disabled. Validate the signed feed and dashboard against the planned target. Enable only after owner approval and the documented provider safeguards. For rollback, disable the worker and provider credential first and leave additive tables and ledgers intact.

The 26 automated tests, category and layout locks, and isolated PostgreSQL checks cover the slot ceiling, atomic final allowance, category cursor, cooldown, resume, stale reports and SKU-specific budget. The local Edge fixture checks desktop and mobile for selected marker precedence, event hover and emoji, and restaurant ranking colors. It blocks all provider network calls. The real Google map and GoTrue-backed user writes still need verified allowance and a disposable local Supabase stack respectively.

Sources: [Vercel cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing), [Google Maps SKU caps](https://developers.google.com/maps/billing-and-pricing/pricing), [Standard billing export timing](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage), [BigQuery free tier](https://cloud.google.com/bigquery/pricing), [BigQuery query safeguards](https://docs.cloud.google.com/bigquery/docs/best-practices-costs).

Release evidence for November 25, 2026: protected preview commit `10ac8d9` passed authenticated Edge in both time zones at desktop and mobile sizes. The calendar now resolves the local day after hydration. The GitHub repository currently lists Preview and Production environments, with no reporting environment or repository approval variable. Desktop browser automation could not verify its active URL, so the Google Cloud table, IAM grants, and real billing counts remain unverified. No live query, migration, discovery activation, or production deployment occurred.

## 15. Release verification and reporting connection

The owner confirmed the Standard export destination project and the US `wadup_billing` dataset. The `google-usage-reporting` GitHub environment now exists, limits deployments to the `main` branch, and has both non-secret export identifiers. The workflow is still gated. The producer discovers only its matching standard export table. A missing table or empty row count produces a pending status and an empty report stream. Metadata-only mode runs without a data query. BigQuery IAM, real bytes and SKU counts need authenticated validation. Use the numeric GitHub identity condition in `WADUP_RELEASE_CHECKLIST.md` to complete the cloud-side connection.

Installed runtime on the Windows workstation remains optional. Podman Desktop is compatible with Supabase, but WSL was unavailable and enabling a virtualization backend requires an administrator and may require a reboot. Instead, the standard runner in this public repository started a Docker-backed Supabase on loopback using synthetic fixtures. On November 25 Eastern, Auth run 45736885392 passed registration, sign-out, sign-in, venue profiles, ratings, and stored weighted rating verification at 1440px and 390px. It never connected to hosted Supabase.

Both protected preview shell scenarios passed at 1440px and 390px in two time zones on `bb3b756`. Isolated Edge fixtures also passed event hover/selection, neighborhood-only staggering at zoom 17, and restaurant medal rankings. Browser traffic to third parties was blocked. Real Google basemap rendering and speed measurements remain pending verified account headroom.

The dedicated Preview verification secret is scoped to `development/official-event-integrations`. The protected POST verifier skips database access. After correcting an omitted completeness flag and preserving partial Fox snapshots, seven hosted venue adapters returned 466 performances, including 253 from Alliance. Tabernacle returned HTTP 429 on the hosted request. The official promoter page returned a shell without structured showtimes in a separate read-only check. The sync keeps prior records for temporary failures subject to the existing seven-day freshness window. The eight-venue hosted acceptance remains incomplete. Local SQL passed cancellation, reschedule, outage, replay and permission checks.

The production audit confirmed main and Vercel production at `f068691`, missing production credential scopes, no billing tables or discovery RPC, and no new official snapshot writer. Existing event and Ticketmaster tables are present. An additional permissions audit verified that the public profiles row policy combined with authenticated column privileges permits cross-account email and phone reads. Authenticated users can also update the ratings on their own reviews directly under current grants. No user records or secret values were read for this audit. The privacy and rating ACL remediation plan, Google data inventory, migration order, and rollback sequence are in `WADUP_RELEASE_CHECKLIST.md`. Production remains untouched.


## 16. Google federation and contact privacy

The owner reported setting up Google Workload Identity Federation for project `project-24f94cff-cf36-4269-940`, pool `wadup-github-billing`, provider `github-actions`, and the dedicated reporter service account. The GitHub `google-usage-reporting` environment now has the provider and service-account identifiers in addition to the export project and dataset. All four settings were checked against the supplied values. The environment allows only `main`, and the paid-query approval variable remains absent.

The metadata-only job uses a separate step with no feed signing secret. GitHub rejected the metadata-only dispatch to `main` with HTTP 404 because the workflow has never been added to that branch. No cloud token exchange or permission check ran. The least-privilege grants reported by the owner fit the metadata calls, but actual permissions remain unverified until the workflow runs under the authorized ref. Keep the trust restriction, discovery pause and paid-query opt-in as they are.

Preview commit `5da0d14` prepares the contact grant change without profile layout or feature changes. Public callers now select explicit display fields, and the existing ambassador contact list and search use a super-admin-only endpoint. The standalone grant SQL removes email/phone reads for anonymous and ordinary authenticated roles while preserving public display fields and the service role. Local PostgreSQL verified replay and inherited PUBLIC grants. The Production database remains untouched. No views reference the contact columns according to read-only schema metadata. Apply the separate privacy SQL only after the compatible app is deployed, with an explicit rollback plan that never reopens contact fields as a side effect.

The protected preview passed desktop and mobile shell checks in both time zones. The hosted read-only adapter retest returned 466 complete performances from seven venues, and Tabernacle again returned HTTP 429. Production remained at `f068691`.

After applying the prepared contact grants to disposable Supabase only, GitHub run 45741226872 passed both screen sizes and verified guest/member contact denial, ordinary-member admin endpoint denial, and authorized super-admin search and roster access. No customer rows or production privileges were changed.

## 17. Google federation verified without a production release

With owner approval limited to the five billing files, main advanced from `f068691` to `c17ba84`. The tested privacy work remains on development at `5da0d14`. Before the push, the exact-SHA Ignored Build Step was tested for the billing SHA and an unrelated SHA, set on both linked projects, read back, and checked against the expected production branch. The live Vercel project canceled deployment `dpl_81juA2EnHkKeJ4kV667bznf3r76E` after the rule returned 0. The second linked project showed no deployment for that commit. Both public domains still point to production deployment `dpl_GDX5UYCpeBktPMcaon75uD46Svcb` at `f068691`, and the www host returned HTTP 200. The exact-SHA skip rules remain in place to guard against an automatic replay of this verification-only commit. They allow other SHAs through.

GitHub run 45742134002 successfully used the federated reporter and read metadata in US `wadup_billing`. The automatic detector returned `export_table_pending`, showing the dataset and table-list access work while there is no matching Standard export to validate. The publishing step was skipped. No query, new service, discovery activation, production build, or hosted migration was executed. Once Google creates and fills the table, rerun metadata-only inspection to check table access and storage. No owner action is required while Google backfills. Actual counts, query-project permissions, and billing-account headroom remain unverified until data is available and the next stage is authorized.

Feature work paused at the owner request. The restoration audit compares f068691 production with the reported preview and records the exact preview key and account-reservation prerequisites. Historical browser keys were not restored. Production and discovery settings were not changed.
Controlled Preview Maps is decoupled from billing export and discovery by a dedicated restricted key and expiring owner-verified provider quota/headroom window. Use WADUP_EXPERIENCE_AUDIT.md for configuration. No hosted Supabase project or migration is required for public map reads. Ordinary release controls and paid discovery remain unchanged.
Owner superseded the preview timebox in 317d725. Ordinary Maps loads directly from the scoped NEXT_PUBLIC_GMAPS_KEY. No BigQuery snapshot, separate project, or test-window variable is needed. Automatic billing monitoring and Places bulk-discovery safeguards remain. Preview key setup is documented in WADUP_EXPERIENCE_AUDIT.md.

On November 25, Vercel metadata confirmed that the stable protected preview serves `317d725` and lacks `NEXT_PUBLIC_GMAPS_KEY`. Production still serves `f068691`. The Google Cloud Console required sign-in and there was no configured local Google Cloud identity. The desktop and mobile protected preview shell checks and all 27 event and Google budget tests passed. The desktop sidebar markup matched production, including the WADUP feed toggle, and the approved category checks passed. Real preview Maps verification is pending the branch-scoped browser key.

The read-only hosted verifier parsed 466 performances with canonical venue locations from seven complete calendars. Alliance returned 253, Songbirds 28 and The Signal 26. Tabernacle was rate limited with HTTP 429, so the combined check reported an incomplete result. No hosted rows were synchronized.
