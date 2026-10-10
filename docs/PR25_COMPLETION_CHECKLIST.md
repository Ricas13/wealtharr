# PR #25 engineering completion evidence

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
