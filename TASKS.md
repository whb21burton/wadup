# WADUP recovery

The production deployment at `f068691` is the source of truth for the experience. The earlier development work and handover are available in the Git tag `wadup-archive-2026-11-25`. The original development branch remains at `317d725`.

## Baseline

- [x] Archive the development history and five project documents.
- [x] Start `recovery/original-experience` from `f068691`.
- [x] Compare the intro at 1440×900 and 390×844. Text, geometry and computed styles matched production. Explore, Account and the seven-day calendar worked in the same checks with Maps traffic held back.
- [ ] Configure the restricted browser key on the protected recovery preview and verify the real application on desktop and mobile. Compare fresh-start and onboarding screens, navigation, account controls, calendar, categories, sidebar, marker appearance, rankings and map interactions against production.
- [ ] Record the recovery preview and screenshots for the owner.

## Selective recovery after the baseline passes

- [ ] Port the eight official adapters and test selected-date showtimes, exact and affiliate purchase links, broken-link fallbacks, canonical coordinates and source reconciliation against isolated data.
- [ ] Port event emoji, unified hover and selected marker priority, neighborhood-only staggering and map performance changes. Recheck both layouts after each group.
- [ ] Port the tested email and phone access protections without changing profile UI or applying hosted migrations.
- [ ] Recover the existing billing reader and the controlled 15-minute bulk discovery worker. Keep bulk discovery paused pending verified usage headroom. Ordinary map rendering uses the restricted browser key directly.

The original category data and desktop sidebar source match `f068691`. The inherited category-chip and desktop-sidebar hash checks report mismatches even against that production source. The expected hashes and the original source were left in place pending owner review.
