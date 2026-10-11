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

## PR #25 engineering audit (11 October 2026)
Detailed evidence is in `docs/PR25_COMPLETION_CHECKLIST.md`. Headlines:
- **Customer-visible strategy without sign-off.** 9Sig is the only enabled, published strategy and it has no recorded specification sign-off (the seed publishes it directly) and no spec card. Live Stripe checkout now refuses until a sign-off is recorded (`src/lib/strategy-evidence.ts`); Admin > Launch lists the gap.
- **Fixed from the audit:** worker starvation by permanently failing strategies, notification head-of-line blocking by one failing provider, negative cash/holdings via corrections or withdrawals, a corrected fill leaving the review unexecutable, fabricated returns from backdated flows, future-dated ledger entries, annualised short-history community statistic, atomic/rate-limited email verification, strict Discord webhook URL parsing, error text stored in worker records, scheduler/backup container privileges.
- **Open hardening:** the app and backup connect to PostgreSQL as the superuser owner role; corporate actions are not modelled (large moves fail closed and need reconciliation); proration is Stripe's, not computed locally.
- **Not verified anywhere yet:** real Stripe, email, Telegram, Discord, market-data, FX, Oracle host, off-site restore, UK legal review, independent security review.
