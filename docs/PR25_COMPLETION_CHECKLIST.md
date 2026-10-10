# PR #25 completion checklist

Records evidence, not certification. "Complete" means there is code, a test that exercises it, and a
recorded verification result. Anything that needs a real host, a real provider, licensed data or a
person's independent approval is **Blocked** (not Complete) however many automated tests pass.

Baseline: `488c2973f92534c940d0c0ed0ece2f0d96c7d7be` (preserved remote
`staging/pr25-ci1042-20261010`, never modified). Work branch: `feat/wealtharr-product-completion`.
Audited head at the start of the 11 October session: `1fc78f3` (CI run 1052 green).

## Verification summary (local, disposable PostgreSQL 16)

| Gate | Result |
|---|---|
| `npm ci` | passed |
| `npm run db:migrate` twice | first applies, second reports every file already applied (no-op) |
| `npm run db:seed` twice | both complete; seed is idempotent |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` (fresh database) | see "Final counts" at the end of this file |
| `npm run build` | passed |
| `npm run test:e2e` (local Chromium) | 114 passed, 6 skipped (existing project-specific skips), 4 failed: the visual pixel-hash tests (landing and demo, desktop and mobile). The hashes are pinned to CI's Linux Chromium; the local browser build renders differently. Baselines were **not** changed. CI is the authority for these. |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Docker | Docker CLI present, daemon not reachable on this host: `docker compose config` validated locally; image build and container start are verified by CI only |

## A. Engineering acceptance (repository, local environment, CI)

| Requirement | State | Implementation | Tests | Notes / limits |
|---|---|---|---|---|
| Full-diff audit of PR vs main | Complete | three independent read-only reviews (migrations, security, financial) of the whole branch diff; each finding verified by hand before action | n/a | findings and dispositions below |
| Migrations 0026-0034 | Complete | reviewed: no high/medium issues. 0031 rewrites `actions` in one transaction and 0028 builds a non-concurrent index; both documented in `docs/ROLLOUT_AND_ROLLBACK.md` | `db:migrate` run twice | applied migrations are never edited |
| Email verification | Complete (fixed) | `7e9e03e`: atomic token consume, origin check, rate limit | `tests/db/verify-email.test.ts` (single use, concurrent use, expiry, cross-origin, rate limit) | |
| Discord webhook URL (SSRF/credential) | Complete (fixed) | `7e9e03e`: parsed URL, exact host, no credentials/port, strict path | `tests/discord-webhook.test.ts` | |
| Error text in stored records | Complete (fixed) | `f4bf8d2`: only application error codes or the error class name are stored | `tests/safe-error-code.test.ts` | |
| Route authorization and tenancy | Complete | every route guarded (user/admin/cron/webhook); object-level checks by `user_id` | `tests/db/route-access-sweep.test.ts`, `tests/db/tenancy-matrix.test.ts` (all strategy routes and action execute) | review found no exploitable path |
| Scheduler/backup container privileges | Complete (fixed) | `bcdcccd`: scheduler unprivileged, read-only, caps dropped, no start-up package install; backup gets an explicit variable list, not the app env file | `tests/oracle-compose-secret-scope.test.ts`; CI renders both compose profiles and asserts | the wget-based scheduler loop has not been run on the real host (section B) |
| Worker fairness | Complete (defect fixed) | `76fbb6a`, migration 0034: every attempt is stamped; failing strategies rotate to the back. Before the fix, 12 permanently failing strategies with a cap of 10 starved all 13 healthy ones (served 0 of 13) | `tests/db/cron-fairness.test.ts` (fails on the old code) | |
| Worker scale 100 / 1,000 / 10,000 | Complete (simulated) | selection and rotation with 10,000 seeded active strategies; runs of 4,000 cover all 10,000 in three runs, each served once per pass | `tests/db/worker-scale.test.ts`; `tests/db/calculation-cost.test.ts` measured the real calculation at about 22 ms per instance (about 107 per second at concurrency 4, small ledgers, local database) which is roughly 11,000 instances inside the default 105 s phase | provider latency, long ledgers and production hardware are not measured |
| Notification freshness | Complete | queued alerts recalculate before sending, obsolete ones cancel (earlier work) | `tests/db/notification-action-freshness.test.ts` | |
| Notification provider isolation | Complete (defect fixed) | `aa70702`: per-channel circuit breaker (3 consecutive failures hold that channel's remaining batch for 15 minutes without using retries); missing endpoints cancel before any provider work. Before this a failing Discord queue could use the whole budget and starve email | `tests/db/notification-channel-isolation.test.ts`, existing delivery/backlog tests | breaker state is per batch, not shared between runs |
| Ledger cannot go negative | Complete (defect fixed) | `c9f4054`: after any correction, cash event or contribution the account's whole ledger is re-folded in time order; cash or holdings below zero roll the transaction back | `tests/db/ledger-timeline-guards.test.ts` | |
| Future-dated entries | Complete (fixed) | `c9f4054`: rejected beyond 60 seconds ahead | same file | |
| Backdated flows vs stored valuations | Complete (defect fixed) | `c9f4054`: stored daily valuations from the flow date onward are removed so no fabricated return or drawdown appears | same file | history shows fewer points rather than invented ones |
| Corrected fill reopens the review | Complete (defect fixed, reproduced first) | `6f90a72`: ledger length in the action fingerprint | `tests/db/corrected-fill-recovery.test.ts` | a zero-effect ledger entry now creates a new action |
| Performance maths | Complete | TWR, money-weighted return, drawdown, same-cash-flow benchmark with hand-computed expected values | `tests/performance-golden.test.ts` | |
| Community money-weighted return | Complete (fixed) | `0654ec7`: only histories of a year or more are annualised | `tests/performance-golden.test.ts`, `tests/db/aggregate-cashflows.test.ts` | |
| Benchmarks fail closed | Complete | single provider, licensed, adjusted, total return, same currency, no holes, flows only on market days | `tests/comparison.test.ts`, `tests/benchmark-window.test.ts`, `tests/benchmark-evidence.test.ts` | no real licensed series exists yet (section C) |
| Billing lifecycle | Complete (mocked Stripe) | free/paid, monthly/annual, trials, renewal, portal changes, past due, cancel, expiry, replay, out-of-order, outage recovery, ownership, store isolation | `tests/db/billing-lifecycle.test.ts` (27 tests), `tests/db/store-webhook.test.ts`, `tests/db/stripe-price-history.test.ts` | proration is computed by Stripe; the app mirrors Stripe's state and does not compute it |
| Live payments need strategy sign-off | Complete | `c8d8ec0`: live Stripe checkout refused while any customer-visible strategy lacks a recorded sign-off; Admin Launch lists them | `tests/db/strategy-evidence.test.ts`, `tests/master-admin-checkout.test.ts` | the sign-off records who approved a card; it does not verify the card |
| Master Admin configurability | Complete (earlier work) | operational settings, prices, instruments, strategy publication in the web interface; only bootstrap values in Docker | `tests/settings-registry.test.ts`, `tests/db/app-settings.test.ts` | |
| Database role separation | Not started (hardening) | the app and backup connect as the owner role that is also the PostgreSQL superuser | none | recommended: separate migration role and a DML-only application role |
| Corporate actions | Not modelled | large price moves are rejected by the plausibility gate and strategies return DATA_REQUIRED until reconciled | `tests/quote-plausibility.test.ts` | splits and mergers need the user to reconcile holdings |

### Review findings and dispositions

- Migration review: 2 low (lock behaviour of 0031 and 0028), documented.
- Security review: no exploitable defect; 1 hardening item (database roles), 1 fixed (stored error text), 1 accepted (a user can be socially engineered into pressing Start on an attacker's Telegram link; no data is disclosed or changed).
- Financial review: 7 items. Verified and fixed: negative balances via corrections or withdrawals (1, 5), stuck review after a corrected fill (2), fabricated returns from backdated flows (3), future-dated entries (4), short-history annualisation (7). Not reachable: nullable ledger account (6), because no code deletes a single account.

## B. Private staging acceptance (needs the real Oracle host)

All **Not started / Blocked**. No SSH access to the host exists in this environment, and the Docker daemon is not available locally.

| Check | Operator steps |
|---|---|
| Bootstrap on the exact tested revision | follow `docs/PRIVATE_STAGING_PR25.md`; record the commit SHA deployed |
| Fresh and upgrade migrations on the host database | take a backup, run `npm run db:migrate` twice; apply 0031 with the scheduler stopped (see rollout runbook) |
| Health and persisted admin settings | `/api/health`, `/api/cron/health`; change a setting in Master Admin, restart, confirm it persisted |
| Scheduler | confirm the BusyBox `wget` loop authenticates and the run reports in `worker_runs`; confirm it runs as UID 65534 |
| Traefik, private database network, volumes | confirm no published database port; confirm the volume survives a restart |
| Backup image and a scratch restore | enable the backup profile with its own credentials, then run `scripts/restore-drill.sh` against a copy |
| Failure recovery and rollback | stop the database, observe degraded health and alerts, start it, confirm recovery; redeploy the previous image and confirm compatibility |

## C. Commercial approval (external; not demonstrable by automated tests)

All **Blocked**.

| Gate | Evidence required |
|---|---|
| Licensed market, adjusted-history and FX data | a contract that permits commercial display and storage, plus real samples validated against the benchmark rules (VTI, SPY, QQQ in the account currency) |
| Verified UK instruments | per exposure: ISIN, listing, currency, wrapper and broker eligibility, fractional trading, actual purchasability; imported as candidates and promoted to EXACT by a person |
| Strategy methodology sign-off | a named reviewer checks each `docs/strategy-specs/` card against its primary source and signs it; independent expected values for golden tests. **The only customer-visible strategy (9Sig) currently has no recorded sign-off**, and no spec card for it exists; live payments are blocked by `c8d8ec0` until it does |
| 3Sig / 6Sig full procedures | the strategy owner's reserve, adjustment and reset rules; not guessed |
| Real Stripe test-mode lifecycle | checkout, failed payment, cancel, portal, webhook delivery against a real test account; all current billing tests use a mocked Stripe client |
| Real email, Telegram, Discord delivery | live provider accounts and delivery receipts |
| Off-site backup and point-in-time recovery | an encrypted repository and a timed restore drill |
| UK legal and regulatory review | written advice on FCA perimeter, financial promotions, consumer terms, privacy and tax presentation; leverage disclosure wording |
| Independent security review / penetration test | an external report |

## Evidence log


Baseline: `488c2973f92534c940d0c0ed0ece2f0d96c7d7be`; preserved remote
`staging/pr25-ci1042-20261010`. Work branch: `feat/wealtharr-product-completion`.
This checklist records evidence, not certification. Unchecked work remains open.

| Requirement | Implementation / evidence to inspect | Acceptance verification | State |
|---|---|---|---|
| Audit all 147 baseline changed files, relevant main code and migrations | `git diff origin/main...HEAD`, `db/migrations`, `src/app/api` | Fresh final diff and ownership/security review | In progress |
| Reconcile status, launch gates and roadmap | `docs/STATUS.md`, `docs/STRATEGY_EXPANSION_LAUNCH_GATES.md`, audit roadmap | Claims traced to code/tests; separate staging and commercial gates | In progress |
| Guided start/resume, import, reconciliation, contributions | `strategy-service.ts`, strategy API routes, `CreateStrategyForm.tsx` | DB onboarding, historical ledger, duplicate/concurrent request tests; browser journeys | Audit pending |
| Action calculation, actual fills, cancellation, stale actions | `action-service.ts`, domain engines/execution | Full lifecycle DB tests, partial fills, fees, review scheduling | Audit pending |
| All supported strategy rules, immutable releases, research gates | `src/domain/strategy`, `docs/strategy-specs`, admin strategy route | Independent arithmetic goldens, release lifecycle, complete regional mapping tests | Audit pending; human source certification separate |
| Decimal amounts and quantity persistence | `execution.ts`, ledger routes, SQL numeric columns | Precision boundary tests and persisted ledger reconciliation | Audit pending |
| Performance and honest same-cashflow benchmarks | `workspace-analytics.ts`, `portfolio-analytics.ts`, `comparison.ts` | Flow timing, gaps, corrections, currencies, adjusted data | Audit pending |
| Admin configuration and encrypted integrations | Admin routes, settings registry/service, setup | Admin permissions/MFA, persistence, no secret readback | Audit pending |
| Billing lifecycle and paid launch gates | Checkout, Stripe webhook, entitlements | Ownership, retries, ordering, expiry and price history DB tests | Shared canonical-state recovery added for missed updates on linked Stripe subscriptions; real Stripe test pending |
| Market data and notification recovery | Market/history worker, notification service, Telegram | Freshness, corporate actions, dedupe/retry, provider safety | Audit pending; actual providers pending |
| Security and reliability | Authentication/session, API routes, worker, migrations | Tenancy matrix, route sweep, MFA, SSRF, audit, bounded jobs | Audit pending |
| Migration and seed integrity | All migrations and `scripts/seed.ts` | Disposable DB: migrate twice, seed; repeat seed preservation | Passed locally through 0033; earlier fresh-seed preservation tests passed |
| Full local verification | `package.json` | npm ci, lint, typecheck, test, build, browser, production audit | Pending |
| Production Docker image and Oracle configuration | Dockerfile, Compose files, CI | Application image build, backup image, Compose validation | Passed CI #1045 at ab66e94, including actual runtime startup and container migrations; latest work requires another CI run |
| Staging runbook and recovery | Master Admin and rollout runbooks | Exact tested revision, bootstrap, migrations, health, backup/rollback | Pending; no host access established |
| Final review and merge | Final diff, GitHub checks | Exact-head green CI and no unresolved engineering blocker | Pending; keep PR open until satisfied |

## Environment

- A fresh local checkout was created; unrelated workspace repositories are untouched.
- Bundled Node is available; a workspace-local npm 10.9.3 was downloaded for `npm ci`.
- A dedicated PostgreSQL 17 cluster on localhost port 55425 contains disposable test databases.
- Docker is not installed on this host; WSL is not installed. Docker verification must
  occur on an available Docker host/CI and must not be reported as locally completed.

## Verification and fixes recorded 10 October 2026

- [CI #1047](https://github.com/Ricas13/wealtharr/actions/runs/38063705746)
  passed at `79992b6917f2e7cfd3942a7beedb32dc53e08ac8`, including billing
  recovery, notification time budgets, the production container and browser suite.
  The financial integrity increment below still requires its own exact-head CI.

- [CI #1045](https://github.com/Ricas13/wealtharr/actions/runs/38044105082)
  passed at `ab66e94e0352b4cfa1791d295701917e2517b28f`: 122 files/990
  unit and database tests, 116 browser tests with six pre-existing project skips,
  unchanged Linux visual baselines, application/backup images, real non-root
  container startup and migration tooling, Compose validation, and zero production
  dependency findings. This is the verified checkpoint before billing recovery.

- Full unit/database suite: 121 files, 989 tests passed on a fresh database after isolating database
  files from each other. Tests still exercise concurrent financial requests.
- All 32 migration files applied twice and seed completed on a fresh disposable database.
- Clean npm 10 install, lint, TypeScript and production build passed after the
  action calculation timestamp migration and dependency lock repair. One later
  admin SQL placeholder repair passed its new real-database test separately;
  exact-head CI must rerun the complete suite.
- Initial Windows browser run: 111 passed, six existing project-specific skips,
  four Linux pixel-baseline mismatches and one flaky multi-account resume test.
  Baselines were not changed. The resume race is fixed; a delayed-refresh
  regression passed six mobile/desktop runs with retries disabled.
- Local PostgreSQL custom-format backup restored into a separate scratch database:
  47 tables, 31 migration records, three plans and 12 strategy versions; seven
  seconds measured restore time. Scratch database removed by the drill.
  This is local recovery evidence, not off-site/PITR/Oracle certification.
- Added transactional onboarding request keys and conflicting-payload rejection;
  opening-snapshot duplicate-security and precision checks; exact persisted fill
  precision checks; Stripe single-period licensed-price checks; fail-closed
  restore client errors; and a dedicated action calculation timestamp that status
  updates cannot advance. Regression coverage accompanies these changes.
- Production dependency audit: zero findings after clean install. Full audit:
  nine development-tool findings (four moderate, five high). No critical findings;
  dev tooling is excluded from the production image. Do not use force-downgrades
  to erase reports; track the upstream ESLint/braces and drizzle-kit/esbuild issues.

### Outstanding engineering review

Do not merge on the strength of the checks above alone. Finish the complete diff
audit, all-profile lifecycle acceptance, notification freshness and worker bound
review, and exact-head Linux
CI including the production Docker image. Verify actual private staging when
host access is available. Source/provider/legal approvals remain external gates.

### Billing recovery policy

Local verification after this increment: lint, TypeScript, repeat migration
through 0032, and the full 122-file/997-test suite passed. Exact-head CI remains
required before treating this increment as verified for deployment.

The scheduler now checks linked website subscriptions against current Stripe
state, using the same local customer ownership and historical price mapping as
the signed webhook handler. It processes up to 100 subscriptions per run with
two requests in flight, an eight-second request timeout and a phase deadline.
Oldest unchecked accounts are selected first; failed attempts rotate and retry
after one hour. Failures, deferred work and a larger queue degrade worker health.
Provider outages do not imply cancellation, and the established `PAST_DUE`
access policy is preserved. Confirmed ended subscriptions return to the free
plan and enforce its strategy limits. The recovery job never charges or cancels
remote subscriptions and never replaces App Store entitlements.

This recovers missed updates for subscriptions already linked locally. It does
not discover unlinked purchases, independently query store-provider accounts,
or certify real Stripe connectivity. Signed webhook delivery and operational
alerts remain required, especially while a backlog is present.

### Notification time budgets

Delivery drains now check the deadline inside each claimed batch. Unattempted
rows return immediately to `PENDING` without consuming an attempt. A partially
processed short batch reports an unfinished backlog. An already-started provider
request may finish after the deadline (provider timeout is ten seconds); this is
a bound on starting work, not cancellation of an in-flight delivery. The direct
admin drain has a 30-second budget. A deterministic database regression verifies
one slow send, release of remaining claims, and successful retry without loss.

### Broker fills and ledger precision

Local verification: lint, TypeScript, all 124 files/1,006 unit and database
tests, and the production build passed. The final historical-overdraft assertion
also passed in a focused run. Exact-head Linux CI remains required.

Imported first purchases keep the initial review open until final HOLD
confirmation. The real-database HFEA journey checks the independently calculated
$5,500 equity and $4,500 bond legs against $10,000 starting cash, both imported
fills, final HOLD, retry recovery after review/closure, conflicting request keys,
and rejection of new backdated or closed-strategy writes.

Fill validation and ledger folding use an isolated 80-digit decimal constructor,
enough for a 30-digit quantity multiplied by a 24-digit price before checking
storage precision. Boundary tests cover exact 24-digit cash values, one-unit
overdrafts at eight decimal places, residual holdings, and independent quantity,
price and fee overflow. Historical balance validation no longer tolerates a
negative smallest cash unit. This does not certify all engine/analytics arithmetic.

Migration 0033 changes future ledger insertion timestamps to `clock_timestamp()`.
Existing timestamps are preserved. The stale-action concurrency regression was
observed failing before migration (the outdated action executed), then passing
after migration: a deposit transaction begun before calculation but inserted
afterwards now invalidates that action. Migration reapplication also passed.

### Action and alert freshness

Local verification: lint, TypeScript, all 125 files/1,013 unit and database
tests, and production build passed. The historical-fill and expired-price
browser journeys passed in both mobile and desktop Chromium (four tests,
retries disabled). Full exact-head Linux CI remains required.

Dashboards now validate saved instructions against a read-only reconstruction of
current financial inputs. A mismatch or failed validation replaces the order
with a refresh prompt and removes confirmation controls. The execution service
performs the same fingerprint comparison while holding the strategy lock, in
addition to checking for newer ledger rows. Already-completed broker fills must
use historical import/reconciliation when an instruction is no longer current.

Queued action alerts recalculate before sending, then reload the notification.
Changed deposits update the message amount; expired quotes, disabled mappings
and inactive strategies suppress obsolete messages. Recalculation failures retry
with a redacted error code; time exhausted during recalculation releases the
untouched claim without consuming an attempt. Database tests cover these paths
and recovery. This reuses existing freshness/mapping rules rather than inventing
a new quote lifetime or claiming live-provider certification. Validation adds
database work at dashboard reads, confirmations and deliveries; operational
capacity and end-to-end provider testing remain acceptance work.

CI #1048 at b6a0a8a passed 1,006 unit/database tests, build and production runtime
checks, but failed both projects' historical-trade browser assertions because
they still expected the now-fixed premature review completion. Those assertions
now require an open review. A new browser journey also checks expired manual
price evidence, hidden confirmation controls, API rejection, and refreshed recovery.

## External gates (no completion evidence yet)

Licensed market/FX/adjusted history and actual samples; real Stripe test-mode lifecycle;
email/Telegram/Discord delivery and recovery; actual broker/instrument/wrapper eligibility;
independent author-method/source rights review; off-site restore; UK legal/regulatory review.
These remain commercial gates. Private staging must fail closed without them.

## Additional October 10 engineering work

Cron auth occurs before settings IO; admin connection errors are redacted and regression-tested. Operator retry supports Telegram and transient action-validation failures. Provider requests reject redirects, and market worker errors use generic codes. These changes require exact-head CI and do not resolve external staging or commercial gates.

## Final counts (11 October 2026 session)

- Unit and database suite on a freshly migrated and seeded database: **141 files, 1,063 tests: 1,063 passed, 0 failed, 0 skipped**, repeated five times in a row with identical results.
- One of my new fairness tests was intermittently wrong (it compared the order in which concurrent attempts finished rather than which strategies were served). It failed about one run in six before being rewritten to compare sets; the same mistake was found and fixed in the 10,000-strategy test earlier. This was a test defect, not a product defect.
- Browser suite (local Chromium): 114 passed, 6 skipped, 4 failed (the four visual pixel-hash tests, which are pinned to CI's Chromium build; baselines unchanged).
- Exact-head CI: [run 38089466544](https://github.com/Ricas13/wealtharr/actions/runs/38089466544) passed on `b08744494a863f0aa2a4d340212d47ef9b543186` (all code and migrations). Later commits in this PR change only tests and documentation until the next entry here.
- Production dependency audit: 0 vulnerabilities. Development tooling audit: unchanged upstream findings, excluded from the runtime image.

