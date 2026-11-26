# WADUP production release checklist and rollback

## Release decision

The development branch can be verified through protected Vercel Preview and a disposable Supabase. Production release requires owner approval, immutable release and rollback commits, verified provider limits, and the checks below. Ordinary map startup has its own restricted browser key. Billing monitoring and the separate automated discovery budgets are independent of map rendering. Hold a full-site release until the live Maps and release gates pass. Real Google usage, hosted event persistence and any live authorization changes are separate gates. Use test users and nonproduction data until approval.

## Before approval

- [ ] Check the GitHub default branch and current Vercel production deployment SHA. Tag evidence with the tested preview SHA and keep the current production URL and deployment ID for rollback.
- [ ] Run the event and usage suites, both category/layout checks, the disposable Supabase Auth browser job, and the protected preview browser checks on desktop and mobile.
- [ ] Run the protected preview's adapter verification. Each venue must return a complete snapshot, positive performance count, and canonical coordinates. Record HTTP failures and partial snapshots. Run the replay, cancellation, outage and pagination cases in local PostgreSQL. For a live hosted persistence test, use a separately approved nonproduction Supabase database and seed data, or defer the first production write to an approved post-release canary. The preview verifier never loads or writes a database.
- [ ] Confirm the intended release includes real-map desktop and mobile verification. Keep Google checks paused until verified account-wide capacity. Exercise Chattanooga and Atlanta on a busy Saturday, event marker stacking, date changes, rankings, and venue profiles after Google access is verified. Keep all third-party metered routes off in fixture tests.
- [ ] Audit local and hosted grants by role. Production currently permits authenticated users to select profile email and phone under a public row policy and to update review ratings through an own-row policy. Treat cross-account contact privacy and direct rating updates as release blockers for the account/rating slice. Expose only the public profile fields on public routes, put contact info behind owner-only access, and route rating writes through validated server handlers. Test two user sessions against the proposed ACL using the existing local fixture and capture a names-only privilege diff before approval.
- [ ] Verify recovery options for the current Supabase plan and capture a schema-only inventory of affected tables, grants and RPCs. Do not share data dumps or secrets. Exercise the exact application rollback against a disposable database after applying the forward SQL.

## Vercel environment scopes

In **Vercel → whb21burtons-projects → whb21burton-wadup → Settings → Environment Variables**, inspect **Production** explicitly. Sensitive values belong in Vercel or provider settings. This inventory verifies names and scopes and cannot verify secret validity.

| Variable | Scope and purpose | Observed production metadata |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production browser build. Correct public URL and anon or publishable key pair | Present |
| `NEXT_PUBLIC_APP_URL` | Production canonical origin | Present |
| `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | Production server-only. Database service and Vercel cron bearer authentication | Absent. Older preview branch only |
| `TM_KEY` | Production server-only Ticketmaster Discovery integration | Absent |
| `NEXT_PUBLIC_GMAPS_KEY` | Browser Maps JS key with HTTP referrer and API restrictions | Absent |
| `GMAPS_KEY` | Server-only Google Geocoding, separately restricted | Absent |
| `GOOGLE_PLACES_KEY` | Server-only legacy Places credential. Keep legacy feature gate off | Present |
| `NEXT_PUBLIC_TM_AFFILIATE_ID` | Browser build. Set only to replace the integration's existing configured fallback | Absent, fallback exists |
| `GOOGLE_USAGE_BILLING_ACCOUNT`, `GOOGLE_USAGE_FEED_SECRET` | Production server-only account binding and HMAC receiver secret | Absent |
| `GOOGLE_DISCOVERY_KEY`, `GOOGLE_DISCOVERY_REGION` or `GOOGLE_DISCOVERY_REGIONS` | Production server-only restricted key and approved city order after authorization | Absent |
| `VENUE_SYNC_ENABLED`, `TICKET_VERIFY_ENABLED` | Production feature flags after schema verification and approval | Absent. Older preview branch only |
| `GOOGLE_PLACES_FREE_BUDGET_VERIFIED`, `GOOGLE_METERED_REQUESTS_VERIFIED` | Independent production release gates requiring actual limits and fresh billing verification | Absent. Keep disabled |
| `VENUE_SYNC_VERIFY_SECRET` | Dedicated Preview secret on `development/official-event-integrations`. The route refuses Production | Present on the development preview branch only |

Replace historically hardcoded keys at their providers. Verify the replacements in the approved target before retiring stale keys. Where a provider supports restrictions and overlap, use restricted replacements and a transition window. Prepare a rollback build that reads the new scoped secrets. Never restore a stale key from Git history. Changes to environment variables require a new deployment to take effect.

## Connect the read-only billing reporter

1. In **Google Cloud Console → IAM & Admin → Workload Identity Federation**, create or select a dedicated GitHub provider in the approved existing project. Issuer is `https://token.actions.githubusercontent.com`. Map `google.subject=assertion.sub` and `attribute.repository_id=assertion.repository_id`. Use the condition below so repository names alone cannot grant access.
2. Grant only the matching pool principal `roles/iam.workloadIdentityUser` on the dedicated reporter service account. Grant the service account BigQuery Data Viewer on `wadup_billing` and BigQuery Job User on the verified on-demand query project. A metadata-only smoke test does not require BigQuery Job User. Use narrow scopes and short-lived credentials. Do not create a downloadable service account key. Review account-wide storage and free query bytes independently.
3. In **GitHub → Settings → Environments → google-usage-reporting**, the branch rule is already restricted to `main` and the known export identifiers are stored. Set `GOOGLE_USAGE_OIDC_PROVIDER`, `GOOGLE_USAGE_REPORTER_SERVICE_ACCOUNT`, `GOOGLE_USAGE_BILLING_ACCOUNT`, `GOOGLE_USAGE_QUERY_PROJECT`, `GOOGLE_USAGE_QUERY_MAX_BYTES` and `GOOGLE_USAGE_RECEIVER` once their targets are verified. Set the shared `GOOGLE_USAGE_FEED_SECRET` as an environment secret and as a sensitive server variable on the approved receiver.
4. Run the metadata-only mode first after the workflow is approved on `main`, or run `node scripts/read-google-billing-export.mjs --inspect` in an authenticated shell with the export project and dataset variables set. An absent table or zero rows is pending. Once data exists, use `--preflight` to dry-run SQL within the 1 GiB query limit. Check source freshness, reported SKU units against Billing, on-demand quota, and account-wide free usage. Enable `GOOGLE_USAGE_QUERY_APPROVED` only with verified headroom and a ready receiver. Vercel discovery needs a separate approval. Never treat a missing export as zero.

```text
assertion.repository_owner_id == '264813889' &&
assertion.repository_id == '1348559406' &&
assertion.ref == 'refs/heads/main' &&
assertion.workflow_ref == 'whb21burton/wadup/.github/workflows/google-usage-report.yml@refs/heads/main'
```

## Google venue data remediation

- The read-only inventory found 328 Place IDs, 239 ratings and 230 proxy photo URLs on Google-source venue rows. Another 10 Google ratings are on rows marked manual or independently located. All 328 Google-source rows have coordinates, and 230 have hours. No mobile Google proxy URLs were found. No nonempty Google review or photo-reference arrays were found in public venue rows at the time checked. Row-level source tags cannot establish the provenance of individual fields.
- Keep the new candidate queue ID-only. Store WADUP or independently sourced names, addresses, coordinates, hours and photos with field-level source and verification time. Preserve venue IDs, ownership, ratings submitted to WADUP, event relationships and independently obtained data. Use owned or independently licensed media to replace legacy proxy URLs. Review proposed field replacements in a dry-run report before any production cleanup.
- Remove legacy payload persistence and any photo/public caching from enabled Google paths. Keep the legacy feature gate off until this is complete. Only cache Google coordinates temporarily where the applicable service terms expressly permit it, with enforced expiry. A per-column audit should cover pending venues, cover-photo URL variants, historical imports and cached response headers.
- Show current Google content only with the required Google Maps branding and third-party attribution. For reviews and photos, carry through the provider's author attribution and URL when supplied. Current legacy code stores flattened review author fields that the venue profile does not read, and the photo proxy does not carry author attribution. Validate renderers using fixtures before any re-enable. Avoid a bulk purge or recategorization until independent sources and owner approval exist.

## Approved rollout

1. Freeze the tested SHA. Verify the production/preview database targets and exact environment scopes. Keep Google and event enable flags off until their respective canary is approved.
2. Apply and inspect `official-venue-schedules.sql`, `official-venue-access.sql`, `official-venue-snapshots.sql`, `ticket-verification.sql`, `google-usage-feed.sql`, then `places-discovery-reservation.sql`. Check existing tables/columns before running idempotent statements. Verify RLS, service-role grants, public RPC denial, indexes, and preserved rows. Leave any incompatible new privacy ACL migration for its separately tested sequence.
3. Promote the expressly approved build. Confirm HTTPS, landing page, date selection, account-aware reads, preview-to-production environment boundary, and legacy ticket links. Enable only the approved event slice and watch the first scheduled writes, selected-day results, affiliate destinations, and failed fetch handling.
4. Activate discovery last. Require a fresh signed report, verified provider quotas across relevant projects, remaining SKU units, the 10% reserve, and enough Vercel execution headroom. Monitor the next four 15-minute invocations and verify at most two reservations per slot. Check no candidate publishes directly and the scheduler pauses on stale data, quota rejection, or exhaustion.

## Rollback

1. Pause Google discovery at the provider and disable application flags before restoring a build that predates the reservation gate. Pause billing publishing and event cron writes when relevant to the incident. Verify no further reservations or snapshot writes.
2. Restore the preverified Vercel deployment or rebuild the known-good commit with active replacement secrets and reviewed scopes. Confirm where the domain points, which cron definition is active, and whether the old build has embedded API credentials. Reject a rollback that would restore uncontrolled provider access.
3. Keep additive database tables, indexes, event history and usage ledgers. Do not reverse these migrations with destructive SQL. If an access grant has to change for rollback, restore only the verified minimal grant, leaving API credentials disabled until smoke tests pass.
4. Verify homepage/date filters, venue profile, canonical URLs, existing event history, and disabled paid-capable paths. Check real errors and service-role authorization. Preserve incident timestamps and restore each worker separately after root-cause verification.

Sources: [Vercel environment variables](https://vercel.com/docs/environment-variables) · [Vercel rollback](https://vercel.com/docs/deployments/instant-rollback) · [GitHub OIDC on Google Cloud](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) · [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) · [BigQuery cost controls](https://docs.cloud.google.com/bigquery/docs/best-practices-costs).

### Federation status

The supplied provider and reporter identifiers are already configured in the GitHub reporting environment. Metadata-only authentication cannot run before the workflow and its supporting scripts are present on `main`. GitHub returned HTTP 404 for the metadata-only dispatch. No Google token was requested. Adding those files to `main` requires an approved path with Vercel's production build skipped for that specific change, or inclusion in a separately approved release. Keep query approval unset. Once the workflow is present, use **GitHub → Actions → Google API usage reporting → Run workflow → main**, with **Check export metadata without starting a data query** selected.

For the separate profile contact grant, verify the current application reads explicit columns and the ambassador admin list/search works through the authorized server route. Apply the contact SQL only after that version is live and approved. An application rollback must target a build compatible with restricted contact fields. Preserve the narrower grants instead of restoring cross-account contact access. Direct review rating protection remains a separate release issue.

A five-file billing-only patch is available at WADUP/node_modules/.wadup-verification/billing-reporter-only.patch. It was checked against the current origin/main index and contains no application release, migration, or Vercel configuration. Apply it only through the approved main-branch procedure that skips the production build.

### Billing connection verified

The owner-approved five-file commit `c17ba84` is on main. Vercel canceled the live project's deployment using the tested exact-SHA ignore rule, which was installed on both linked projects before the push. Production remains `f068691`. GitHub run 45742134002 passed federation and the dataset metadata listing. Its result was `export_table_pending`. The query/publish step was skipped. No additional owner setup is required for metadata-only access. Rerun it after export creation, then verify the table, storage, freshness and approved free query safeguards before configuring anything that submits actual queries.

