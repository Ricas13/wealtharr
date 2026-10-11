# Staged rollout and rollback runbook

Written from what the repository does today. Steps marked **[person]** need someone with access to the real host; nothing here has been rehearsed on a production host.

## Before any release
1. CI green on the release commit (`verify`: lint, typecheck, tests against PostgreSQL 16, build, browser tests, accessibility).
2. `npm run launch:preflight` against the target environment; read every failing line.
3. **[person]** Take a fresh database backup (`scripts/backup-postgres.sh`) and confirm it landed in the off-site store.
4. Read the migrations in the release (`db/migrations/`). Migrations are applied by filename and never rewritten; each one must be additive or backward-compatible with the previous application version, because rollback runs the old code against the new schema.

### Known lock behaviour in migrations 0026-0034 (from the PR #25 migration review)
- `0031_action_calculation_time.sql` adds a column and then rewrites every row of `actions` inside one transaction, holding an exclusive table lock until it commits. Apply it in a quiet window (stop the scheduler first); duration grows with the size of `actions`.
- `0028_verified_adjusted_history.sql` builds an index on `price_history` without `CONCURRENTLY` (the migration runner uses one transaction, which forbids it). That blocks history ingest writes while it builds; harmless while the table is small.
- Applied migrations are never edited (checksummed by filename); a lock problem is handled by timing, not by rewriting history.

### PostgreSQL role cutover

On an existing host: back up database and env file; preserve encryption/session
secrets and the previous app image. Add new random `APP_DB_PASSWORD` and
`BACKUP_DB_PASSWORD` to the private env file, then stop scheduler. Build
the opt-in maintenance image, run migrate twice, seed, provision roles and
verify permissions. The app uses the enforced non-owner URL; the backup role
has SELECT-only privileges. If any check fails, stop and do not deploy the
new app. Never regenerate bootstrap keys or wipe the database. Re-provision
grants after future schema migrations.

## Staged rollout
1. **Staging first.** **[person]** Deploy to staging with a copy of production-shaped data, run `npm run db:migrate`, then the browser suite (`npm run test:e2e`) and a manual pass: sign in, start a strategy, review an action, billing page.
2. **Production, quietly.** **[person]** Deploy the new build, run `npm run db:migrate`, then check `/api/health` and `/api/cron/health`. Watch Admin > Launch and the operational alerts for one cron cycle (an hour) before announcing anything.
3. **Feature gates.** New behaviour that depends on a person's decision ships off: price-history storage (`MARKET_DATA_HISTORY_ADJUSTED_LICENSED`), admin two-step enforcement (`ADMIN_MFA_REQUIRED`), customer publication of any strategy (needs a recorded attestation). Turn on one at a time in Admin > Settings and watch the alerts.

## Rollback
- **Application only (no migration, or the migration is backward-compatible):** redeploy the previous build. Nothing else changes.
- **A migration must be undone:** do not edit applied migrations. Write a new forward migration that reverses the effect, ship it as a normal release.
- **Data damaged or a migration was destructive:** **[person]** restore from the last good backup using `scripts/restore-drill.sh` as the reference procedure (it restores to a scratch database and refuses to touch an existing one). Point-in-time recovery depends on the host's PostgreSQL setup, which is not configured by this repository.
- **A published strategy version is wrong:** versions are immutable (migration 0014). Publish a corrected new version and retire the bad one; users on the bad version are offered the upgrade according to its upgrade policy. Do not edit the row.
- **A setting change caused trouble:** revert it in Admin > Settings; changes take effect within about 15 seconds without a restart. If the settings screen itself is unreachable, restore access with the four bootstrap environment values (`DATABASE_URL`, `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `AUTH_TRUST_HOST`).
- **Encryption key rotation went wrong:** keep `APP_ENCRYPTION_KEY_PREVIOUS` set to the old key until every stored secret decrypts under the new one (see `tests/db/key-rotation.test.ts`).

## After
Record what shipped and any manual step in `docs/STATUS.md` in the same release.
