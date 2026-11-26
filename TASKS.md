# WADUP recovery

The production deployment at `f068691` is the source of truth for the experience. The earlier development work and handover are available in the Git tag `wadup-archive-2026-11-25`. The original development branch remains at `317d725`.

## Baseline

- [x] Archive the development history and five project documents.
- [x] Start `recovery/original-experience` from `f068691`.
- [x] Compare the intro at 1440×900 and 390×844. Text, geometry and computed styles matched production. Explore, Account and the seven-day calendar worked in the same checks with Maps traffic held back.
- [x] Configure the restricted branch key and verify real Maps in desktop and mobile Edge. Each viewport loaded Google tiles with one Maps JavaScript load, showed ten ranked restaurant pins, and accepted pan, zoom, and Account interactions.
- [x] Capture production and recovery desktop/mobile introductions and Maps baselines. The introductions matched pixel for pixel. The protected recovery site uses the stable `whb21burton-wadup-git-recovery-ori-68fe98-whb21burtons-projects.vercel.app` alias.

## Selective recovery after the baseline passes

- [x] Port the eight official adapters and event/ticket handling. Commit `7588835` passed the desktop/mobile real Maps smoke test and 21 event tests. Isolated public-feed ingestion persisted 466 performances from seven complete feeds. Replays, canonical coordinates, canceled/rescheduled behavior, 252-row pagination, and same-day links passed.
- [ ] Reverify the live Tabernacle feed. Its request remained incomplete. Hosted event persistence awaits a safe database target and explicit authorization for migrations. The recovery preview keeps hosted event writing disabled.
- [x] Port event emoji, one-piece marker hover, selected-marker priority, neighborhood-only staggering, and map overlay reuse. Keep the original category, splash, and desktop sidebar markup. On `d22fe03`, real Maps ran in desktop/mobile Edge and showed ten ranked restaurants in each. Isolated showtime responses verified Alliance's two desktop links, Songbirds desktop hover and mobile tap, the selected date, and stacking at neighborhood zoom. Both production and final recovery intro captures matched pixel for pixel.
- [x] Port the tested email and phone access protections and existing test workflow. Isolated SQL verified public denial, service-role access, and replay. The disposable Supabase Auth browser run `45828527737` passed on commit `6926ede`. The hosted grant migration is unapplied.
- [x] Recover the existing billing reader and the controlled 15-minute bulk discovery worker. Local tests verified report freshness, conservative reserves, slot limits, retries and candidate ID storage. Ordinary map rendering uses the restricted browser key directly.
- [ ] Keep hosted discovery paused until the billing source and spending headroom are verified. The signed feed receiver and reservation SQL require an approved hosted database migration before use.

On November 26, HTTP checks confirmed that protected Preview has bulk discovery, the hosted official feed, and billing ingestion disabled. Production still serves `f068691`. The combined app built successfully, 27 event and budget tests passed, and no hosted migrations were applied.

The original category data and desktop sidebar source match `f068691`. The inherited category-chip and desktop-sidebar hash checks report mismatches even against that production source. The expected hashes and the original source were left in place pending owner review.
