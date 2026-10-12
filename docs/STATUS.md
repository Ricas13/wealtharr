# Status of the audit and launch-gate items

> **Current development note — PR #25, 2026-10-09:** This document includes older audit snapshots of `main`. The section immediately below supersedes their historical strategy-customisation and adjusted-price-ingestion claims. GitHub CI passing is not independent model certification, UK broker eligibility, a licensed data contract, a restore test or regulatory approval.

Checked against `main` on 2026-10-09 by reading the code and running the tests (unit/integration against PostgreSQL 16, browser tests, lint, typecheck, build, dependency audit), not by trusting earlier documents. **Fixed** means the behaviour is in code and a named test fails without it. **Open** means not done. **Needs people** means no code change can finish it. Where an item is only partly done, the remainder is stated.

Not covered by anything below: no test has run against live Stripe, a live email service, a real market-data provider, Google or Apple sign-in, or the app stores.

## Current PR #25 implementation (not yet merged)

| Capability | What can be verified in code | What still requires evidence |
|---|---|---|
| Curated strategy rules | Code-locked author/reference profiles; customers cannot choose arbitrary weights or create a custom strategy. 9Sig, fixed allocation and research momentum mechanics have tests. | Independent author-specific golden cases, methodology rights, full versions of many popular strategies |
| Real broker fills and reviews | Multi-leg rebalance calculations, frozen 9Sig quarterly targets, contributions recorded once, actual-fill reconciliation and stale-action rejection; HFEA full fill-to-HOLD integration | Acceptance tests for all other implemented strategies and real exchange quotes |
| Region and wrapper support | Fail-closed complete strategy market mapping, leverage/duration checks, broker/currency eligibility filters and a pre-switch holding compatibility guard | Operator must prove actual tradability, ISIN/ticker accuracy, ISA/SIPP eligibility and broker restrictions |
| Corporate-action-adjusted history | Migration 0028 quarantines previously imported rows; a licensed provider must explicitly mark *each* historical CLOSE as adjusted before the momentum engine can use it | Contract rights, dividend/split correctness, real provider end-to-end testing |
| Strategy publication | Migration 0029 invalidates draft sign-offs on direct SQL edits; API invalidates on edits; enabling a curated release requires active publication, recorded attestation, canonical rules and a complete market | Human reviewers and provenance for the attestation; database input is not independent evidence |
| Master Admin | Encrypted providers, Stripe/webhook configuration, current/history quote checks, research release/market readiness view and audit logs | Live external service integration, operational drills and billing/recovery exercises |
| Explore catalogue | `/app/explore` lists every catalogue strategy with a plain-English rules summary (exposure weights and review frequency only, no tickers or return figures). A pure state machine (`src/domain/explore-catalogue.ts`, `tests/explore-catalogue.test.ts`) shows Start only for AVAILABLE cards: definition enabled, PUBLISHED in-window version, stored rules equal the code-reviewed rules and a complete verified market for the viewer's country. Disabled, draft-only, research-pending and momentum strategies can never be AVAILABLE. `/app/strategies/new?strategy=<key>` preselects only keys the form already allows. Community stats now use the latest PUBLISHED version only | Browser run of the new e2e/accessibility cases; attestation is not part of the card state (enabling a release already requires it) |
| CI | PostgreSQL on official ECR mirror avoids unauthenticated Docker Hub rate limits. Migrations, tests, build, browser and audit are enforced | Live staging, scale tests, backups, UK legal/regulatory approval |

The application is **not commercially releasable** merely because code checks pass. Strategy evidence shown on the research page records configured state, not independent certification.

## Audit roadmap (`docs/WEALTHARR_AUDIT_AND_FIX_ROADMAP_2026-10-08.md`)

| Item | Status | Evidence |
|---|---|---|
| CI-01 visual baselines | Fixed | `tests/e2e/visual.spec.ts` (digests reviewed, capture accepted only after two identical frames, checks still enforced) |
| FIN-01 unrestricted overrides | Fixed | `src/domain/manual-override.ts`, `tests/manual-override.test.ts`, `tests/e2e/historical-trade.spec.ts` |
| FIN-02 stale notification identity | Fixed | `src/domain/action-fingerprint.ts`, `tests/action-fingerprint.test.ts` |
| FIN-03 override does not drive sizing | Fixed | `tests/action-fingerprint.test.ts`, `tests/execution.test.ts` |
| FIN-04 historical buy to review journey | Fixed in code; the specific TQQQ example is not run | `tests/historical-trade.test.ts`, `tests/historical-trade-price.test.ts`, `tests/e2e/historical-trade.spec.ts`. No provider history exists yet (Phase 3), so the journey uses user-entered fills |
| FIN-05 exchange-local trading date | Fixed | `tests/historical-trade-price.test.ts` |
| BILL-01 price shown equals price charged | Fixed | `src/app/pricing/page.tsx` and `src/app/page.tsx` read `plan_prices`; `src/app/api/billing/checkout/route.ts` checks the Stripe price's currency, amount, interval and active state |
| BILL-02 webhook ordering | Fixed | `src/app/api/stripe/webhook/route.ts` (per-subscription lock, canonical Stripe state), `tests/db/billing-lifecycle.test.ts` |
| BILL-03 webhook ownership | Fixed | same route (customer and owner cross-check), `tests/db/billing-lifecycle.test.ts` |
| BILL-04 account deletion | Fixed | `src/lib/account-deletion.ts`, `tests/db/account-deletion.test.ts` |
| OPS-01 unbounded worker | Fixed (bounded; not a durable queue) | lease, time budget, concurrency, stalest-first in `src/app/api/cron/actions/route.ts`; `tests/cron-orchestration.test.ts`, `tests/work-pool.test.ts`. No 1,000 or 10,000 user load test has been run |
| OPS-02 retry loop | Fixed | `tests/delivery-retry.test.ts`, `tests/db/notification-delivery.test.ts`, `tests/db/notification-backlog.test.ts` |
| OPS-03 health ignores partial failure | Fixed | cron route status, plus alerting: `src/domain/ops-health.ts`, `tests/ops-health.test.ts`, `tests/db/ops-monitor.test.ts` |
| OPS-04 backup restore | Needs people | `scripts/restore-drill.sh` is tested against a local dump (`tests/restore-drill-script.test.ts`); it has never been run against the real off-site repository |
| ADMIN-01 publish race | Fixed | migration 0014, `tests/db/strategy-version-lifecycle.test.ts` (includes a concurrent publish) |
| ADMIN-02 lenient validation | Fixed | `src/domain/strategy/config.ts`, `tests/strategy-config.test.ts` |
| SEC-01 admin security | Partly fixed | two-step sign-in (`tests/totp.test.ts`, `tests/db/two-step-sign-in.test.ts`, `tests/db/admin-mfa-gate.test.ts`), new-device alerts (`tests/db/new-device-alerts.test.ts`), security emails, rate limits by trusted proxy address. Open: passkeys, an independent security review, a Content-Security-Policy |

## Defects found while writing this file (fixed in the same change)

- Engine name mismatch: the seed and catalogue used `MOMENTUM`; the only registered engine is `MOMENTUM_ROTATION`, so `getStrategyEngine("MOMENTUM")` would throw. Aligned, with migration 0023 for existing rows and `tests/catalogue-consistency.test.ts` so it cannot drift again.
- HFEA and Golden Butterfly drafts had a 5% drift band in the seed and 0% in the reference catalogue. The seed now reads the presets from the catalogue (one source of truth). Draft rows are corrected by migration 0023. The 0% choice (rebalance on the calendar) follows the catalogue; confirm it against the primary source in the strategy spec.

## Strategy launch gates (`docs/STRATEGY_EXPANSION_LAUNCH_GATES.md`)

The checked items in that file are unchanged and accurate. Unchecked items:

| Gate | Status |
|---|---|
| Verify remaining primary-source rules and calendar conventions | Open (Track R: `docs/strategy-specs/`) |
| Validate PAA, VAA against author golden cases; wire trusted monthly series | Open (needs Phase 3 data) |
| Licensed historical prices in `EngineContext`, corporate actions, calendars, no-look-ahead backtests | `loadTrustedHistory` is wired into action calculation and covered by database tests. Real adjusted-data validation, calendars and independent backtests remain open |
| Full 3Sig/6Sig procedures | Open: not guessed, left as research |
| Advanced custom strategy editor | Out of scope: customers and administrators cannot author arbitrary financial algorithms |
| Golden-case regression against primary-source examples | Open for every strategy except what `tests/value-target.test.ts` and `tests/fixed-allocation.test.ts` cover with self-computed values; independent expected values are still needed |
| Per-version release attestations; widen the publishable allowlist | Attestations exist (0025) and draft edits revoke them (0029); canonical rule checks supplement the engine allowlist. Independent human certification and widening support remain open |
| Strategy-specific disclosures (leverage, volatility decay) | Fixed for the leveraged catalogue entry (HFEA): the catalogue carries a leverage disclosure that the seed stores, with a test that any leveraged strategy has one. Wording still needs legal review |
| Verify exposure, currency, wrapper, fractional trading and purchasability by region and broker | Open (Phase 2). No instrument mappings are seeded |
| Commercial data and licensing rights | Needs people. An optional `yahoo` provider exists (owner decision) but Yahoo's chart endpoints are unofficial and NOT licensed for commercial redistribution; Admin > Launch warns while it is selected and the market data gate stays failed. Replace with a licensed provider before charging customers; each `.L` symbol must be spot-checked by the owner |

| Verify exposure, currency, wrapper, fractional trading and purchasability by region and broker | Open (Phase 2). No instrument mappings are seeded. Admin > Instruments now lists import CANDIDATE mappings with a checklist-gated verify/promote and reject flow (admin, MFA when ADMIN_MFA_REQUIRED; same-origin, one transaction, audit event; refuses non-candidates and ambiguous pairs). The manual "add mapping" form now only creates disabled candidates, instrument/trading-line edits that would change a verified mapping are refused, and migration 0037 defaults fidelity to CANDIDATE; the owner still has to perform the actual verification against issuer documents |
| Commercial data and licensing rights | Needs people |
| User-acceptance tests for every supported strategy | Open |

## Deployment and revenue gates

| Gate | Status |
|---|---|
| Host, HTTPS, PITR Postgres, staging database | Needs people |
| Secrets in a secret store | Partly: operator settings are encrypted in the database and editable in Admin > Settings; four bootstrap values stay in the environment. Key rotation exists (`tests/db/key-rotation.test.ts`) |
| Real transactional email, SPF/DKIM/DMARC | Needs people |
| Stripe catalogue and test-mode checks of ordering, replay, cancellation, proration, failed collection | Webhook ordering, replay, cancellation covered by `tests/db/billing-lifecycle.test.ts`; proration and failed collection in a live test-mode account are not exercised |
| Contracted market-data service | Needs people |
| Protected scheduler with singleton control | Fixed in code (lease); monitor delayed jobs: alerting added (`src/lib/ops-monitor.ts`) |
| Metrics, traces, structured redacted logs, uptime probes | Partly: operational alerts and `/api/cron/health` exist. Structured logging and traces are open |
| Encrypted off-site backups and a tested restore | Scripted (`scripts/backup-postgres.sh`, `scripts/restore-drill.sh`); the real run needs people |
| CDN/WAF, rate limiting, CSP, penetration review | Partly: rate limits on sign-in, register and reset. Open: CSP, WAF, penetration review |
| Staged rollout and rollback runbook | Written (`docs/ROLLOUT_AND_ROLLBACK.md`); never rehearsed on a real host, which needs a person |
| Independent UK review (FCA perimeter, promotions, consumer terms, GDPR, data licensing, tax presentation) | Needs people |
| Company ownership, support mailbox, policies, continuity | Needs people |
| Make all journeys work without a quote provider (manual-data variant) | Partly: the manual mode and provenance exist; end-to-end manual-data tests for each strategy are open |

## Not in the original documents but now built

Sign-in with Google and Apple; installable mobile web app and Android/iOS shell; App Store / Google Play subscriptions alongside Stripe; admin settings screen and first-run setup; operational alerts; accessibility checks. Each is described in its pull request; none has been tested against the live external service it depends on.

## Strategy catalogue, Phase 4 gate (attestations)
- Publishing a version through the admin route now requires a recorded attestation (spec card path under `docs/strategy-specs/` and where the golden tests live) via the new `ATTEST` action; table `strategy_version_attestations` (migration 0025). The attestation records who signed and when; it does not verify the card itself, a person must.
- Momentum engines remain research-only (not in the customer-publishable allowlist).
## Strategy catalogue, Phase 1 (engineering)
- Typed exposure registry: `src/domain/strategy/exposures.ts`, catalogue coverage tested.
- Ordered-legs rebalance planner: `src/domain/strategy/rebalance-plan.ts`, hand-computed golden tests. The fixed-allocation engine now shows the whole plan as "Full plan, step n" rows; it still proposes only the first step and recalculates from the actual fill.
- Customer-defined weights have been removed in PR #25: every published named strategy uses a code-reviewed immutable allocation and review method.
- Semi-annual and threshold-only schedules (merged earlier).
- The planner is wired into the fixed-allocation engine. Spec-card sign-off remains open. Three-fund/60-40/80-20 weights are code-defined; user weight inputs are deliberately unsupported.

## Strategy catalogue, price history ingest
- The hourly momentum history importer is off until Admin enables licensed adjusted storage. Every daily CLOSE must also contain an explicit `corporateActionsAdjusted:true` provider field; migration 0028 makes legacy rows ineligible until revalidated.
- The provider adjustment flag is a technical input requirement, **not proof** that the vendor calculated distributions and split-adjustments correctly; real samples, contracts, licensing and exchange calendars still require external review.
- Three-fund, 60/40 and 80/20 are seeded as disabled fixed-allocation drafts. Customer weight inputs are not supported.
- The platform stores spec-card attestations, but independent human sign-off and full author-method goldens are still required.

## Launch enablement groundwork (12 October 2026)
- `docs/LAUNCH_ENABLEMENT.md` lists, for 9Sig, HFEA, 60/40 and All Weather, what is done in code and what only the owner or an administrator can do (EXACT mappings, spec-card sign-off, ATTEST, PUBLISH, ENABLE, data licensing, legal). It records no attestation and invents no instrument.
- All Weather now has hand-derived golden cases in `tests/strategy-reference-golden.test.ts` (initial split, rounding residue, on-target, equity-heavy and bond-heavy drift, deposit, zero threshold, tolerance edge). Not yet run in this environment (no Node); the card remains DRAFT and the withdrawal case is still open. No gate, seed or rule changed.

## PR #25 engineering audit (11 October 2026)
Detailed evidence is in `docs/PR25_COMPLETION_CHECKLIST.md`. Headlines:
- **Customer-visible strategy without sign-off.** 9Sig is the only enabled, published strategy and it has no recorded specification sign-off (the seed publishes it directly). A DRAFT spec card now exists (`docs/strategy-specs/9sig.md`, NOT SIGNED OFF, reviewer PENDING) with a code comparison in `docs/9SIG_IMPLEMENTATION_GAP.md`. Live Stripe checkout still refuses until a sign-off is recorded (`src/lib/strategy-evidence.ts`); Admin > Launch lists the gap.
- **9Sig 1.1 (author's method) delivered as a DRAFT version, not published (2026-10-12).** `src/domain/strategy/kelly-signal.ts`, selected only by `methodRevision:"KELLY_SIGNAL_2026_10"` in the new version's config (`CANONICAL_9SIG_V1_1_CONFIG`, `catalog/9sig.ts` `laterVersions`). It changes four things: calendar quarter-end reviews with no growth step on resume or migration; an anchor on the actual post-order balance; distributions counted as new cash (by recording time); and one 90% buy cap per quarter, after which a capped or cash-limited quarter closes. There is no tolerance band and no zero-target commit. A target override is consumed by the review it is used in. 1.0 (`CANONICAL_9SIG_CONFIG`) and its instances are unchanged; `assertCuratedRules` accepts the 1.1 rules only for version string "1.1". The seed inserts 1.1 as an OPTIONAL DRAFT; nothing is attested, published or enabled. Hand-worked golden tests are in `tests/kelly-signal-golden.test.ts`. **Not yet run** (no Node in the authoring environment; first run in CI). Still open:
  - Publishing needs owner answers to Q1, Q2, Q2b, Q4, Q9 and Q10 on the card, then ATTEST and PUBLISH.
  - The NYSE holiday list is empty.
  - 30 Down, the spike reset and the base reset are not implemented.
- **Fixed from the audit:** worker starvation by permanently failing strategies, notification head-of-line blocking by one failing provider, negative cash/holdings via corrections or withdrawals, a corrected fill leaving the review unexecutable, fabricated returns from backdated flows, future-dated ledger entries, annualised short-history community statistic, atomic/rate-limited email verification, strict Discord webhook URL parsing, error text stored in worker records, scheduler/backup container privileges.
- **Open hardening:** the app and backup connect to PostgreSQL as the superuser owner role; corporate actions are not modelled (large moves fail closed and need reconciliation); proration is Stripe's, not computed locally.
- **Not verified anywhere yet:** real Stripe, email, Telegram, Discord, market-data, FX, Oracle host, off-site restore, UK legal review, independent security review.

## Advance review reminder (optional)
- New setting `REVIEW_REMINDER_LEAD_DAYS` (Admin > Settings > Notifications, 0-14; blank = default 2 days, 0 = off). When set, the hourly worker creates one `REVIEW_UPCOMING` notification per strategy review ("<Strategy> review due <date>") for active strategies whose newest action is NO_ACTION with a fresh calculation, held until 08:00 in the user timezone, using the existing `review_key` unique index for one-per-review dedupe. Date only: no amounts or instructions. Channels follow plan entitlements and connected endpoints; a reminder is cancelled at send time (`REMINDER_NO_LONGER_CURRENT`) and hidden from the Activity page if the strategy is no longer active or the review date moved or has arrived. Known limits: the lead time is a multiple of 24 hours (not calendar days, so it can shift by an hour over a daylight-saving change); only strategies whose latest calculation is under 2 days old and says nothing is due get a reminder; a reminder already sitting in an inbox or chat cannot be recalled once sent. Migration 0036 adds nullable `strategy_instance_id` and `reminder_due_at` to `notifications`.
- Evidence: `tests/review-reminder.test.ts` (window, quiet hours, DST, key, wording, wiring), `tests/db/review-reminder.test.ts` (once per review, paused/closed/stale, plan channels, cancellation). Not yet run in CI at the time of writing.

## Strategy plugins (code organisation, no behaviour change)
- Every built-in strategy is now one plugin file under `src/domain/strategy/catalog/<key>.ts` (profile, seed definition, spec-card and golden-test pointers), registered in `catalog/index.ts`. `RESEARCH_STRATEGIES`, `LEVERAGE_DISCLOSURE`, `CANONICAL_9SIG_CONFIG` and `assertCuratedRules` keep their import paths and are derived from the registry. The 9Sig special cases in the admin route, admin page, curated-release check and seed script, and the second hard-coded definitions list in `scripts/seed.ts`, were removed.
- Rules, engines, configs, input schemas, disclosures and seed rows are unchanged (pinned by `tests/strategy-plugin-snapshot.test.ts`). The seed remains insert-only apart from the guarded research-only realignment (coffeehouse, core-four, swensen).
- Not executed: this change was authored without a Node toolchain, so typecheck, `npm run verify`, the unit tests above and the database/seed tests have not been run; CI is the first run.
- Adding or changing a strategy: see "How to add or change a strategy" in `docs/strategy-engines.md`.

## Admin entitlement super-user
- An ADMIN is an entitlement super-user: no active-strategy limit, every plan feature, every notification channel, no strategy-key restriction (`adminEntitlementSnapshot()` in `src/domain/entitlements.ts`, resolved by `loadEntitlementsWith` in `src/lib/entitlement-service.ts`). This is an entitlement bypass only; admin-only powers stay behind `requireAdmin` and MFA.
- Every plan-resolution path (create, reactivate, switch, linked accounts, enforcement, notifications, previews) goes through that loader, so the hourly enforcement pass never pauses an admin. Demoting an admin re-applies normal plan limits on the next enforcement pass (cron, plan edit or billing event). Tests: `tests/admin-entitlements.test.ts`, `tests/db/admin-entitlements.test.ts` (database test needs `DATABASE_URL`).
- An ADMIN can also start, switch to and preview a strategy whose definition is **disabled** for customers, to test it (`includeDisabledStrategies` on the entitlement snapshot, true only for a live ADMIN, derived server-side from the database role and never from request input, query string or token). The strategy must still have a PUBLISHED in-window version (a DRAFT is never startable, so an instance cannot be pinned to a mutable version) and still passes the market/mapping availability check. Customers never see or start disabled strategies; the new-strategy page labels these for admins as "Admin preview - not available to customers". Such instances are marked `strategy_instances.admin_disabled_preview` (migration 0035); if the owner is later demoted, `enforceStrategyEntitlements` pauses exactly those instances while the definition is still disabled and reactivation is refused. Customers who run a strategy that was disabled after they started it are unaffected. Tests: `tests/admin-entitlements.test.ts`, `tests/db/admin-disabled-strategies.test.ts`. Not yet executed: no Node toolchain was available when this was written, so these tests and the migration have not been run.
