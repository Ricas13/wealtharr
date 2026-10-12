# Rules for this repository

- Money and ratios use Decimal.js only; never floating point (the money-weighted return is the one documented exception, see `src/domain/performance.ts`).
- Strategies reference economic exposures, never tickers.
- Published strategy versions are immutable (database trigger, migration 0014); changes are new versions.
- Fail closed: stale, missing or ambiguous data yields `DATA_REQUIRED`, never a guessed action.
- Never invent a strategy rule. Every rule traces to a primary source in `docs/strategy-specs/`.
- Every strategy version needs golden tests with independently computed expected values before it can be published.
- Do not disable or loosen visual, e2e, accessibility or safety tests; fix the cause.
- Run `npm run verify` before each commit; database tests need `DATABASE_URL` (see `.github/workflows/ci.yml`). Keep each PR to one task.
- Configuration lives in Admin > Settings (encrypted in the database); only `DATABASE_URL`, `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `AUTH_TRUST_HOST` stay in the environment. Add new operator settings to `src/domain/settings-registry.ts`, not to `.env`.
- Never put secrets in the repo.
- Status of every audit and launch-gate item is in `docs/STATUS.md`; update it in the same PR that changes an item.

## Owner's strict strategy-release policy (12 October 2026)

- **Binary product catalogue:** a strategy is either completely implemented, independently reviewed, market-eligible and fully usable, or **not shipped**. No research/draft/coming-soon cards, APIs, onboarding choices, demos, plan benefits, SEO claims or public carousel entries for incomplete strategies.
- Do not leave unfinished reference plugins in the production catalogue or fresh-install seed. Until removal/migration is complete, fail closed at customer-facing release gates and preserve existing customers' immutable ledger and version history.
- A recorded operator attestation by itself is not proof of true methodological or legal correctness. Do not fabricate human sign-offs, licensed prices or instrument mappings to switch anything on.
- A genuinely released strategy may be subject to an honest plan-upgrade action; a half-implemented one must not appear at all. Any customer-visible strategy must pass every acceptance requirement in the Full Completion Specification (12 October 2026).
