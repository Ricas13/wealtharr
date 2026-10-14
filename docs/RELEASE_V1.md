# Wealtharr v1 — single release acceptance contract

> This is the release contract for the last feature PR. Never call a merge, a green CI build, or a healthy HTTP endpoint a verified live financial product. The public beta and paid commercial launch are separate decisions.

## Fixed v1 scope (no new features)

- Responsive public site, sign-up, login, password reset, email verification, protected member and admin pages.
- At least one **complete** customer-available strategy with explicitly configured, verified instruments for the customer's region and account wrapper. Start with the independently tested Global 60/40 (GBP) model; unfinished or research-only 9Sig and other methods stay disabled. No customer-facing draft strategies.
- The customer enters opening positions and cash, records contributions and confirmed fills, gets correctly sized BUY/SELL/HOLD or explicit DATA_REQUIRED, receives one deduplicated reminder per review cycle, and can return with identical records after restart.
- Admin owns plan/feature/strategy/user controls, encrypted provider configuration, launch status and integration diagnostics. The app never performs brokerage trades.
- Deployment keeps the existing PostgreSQL volume, bootstrap keys, audited ledger and previous image. Do not run Docker down -v or reset encryption secrets.

## Release checklist — all required for invitation-only beta

1. The release commit has green exact-head CI (lint, types, migration twice, unit/DB tests, production build/container, browser E2E, dependency audit). PR approval is not deployment proof.
2. Deploy the *same reviewed commit* to the existing Oracle host with controlled migrations, rollback image and a verified, recent off-site DB restore. Follow docs/ORACLE_PUBLIC_DEPLOYMENT.md and docs/ROLLOUT_AND_ROLLBACK.md.
3. Run npm run release:smoke -- --url https://wealtharr.vpn4u.cc from outside the host; all HTTP checks must pass. This includes core health, public pages, authenticated-route denial and cron authentication.
4. On the ACTUAL deployment: register a fresh test user, verify an email, log in, reset password, enter a complete strategy and opening GBP cash/holdings, generate its first allocation and confirm a paper/manual fill.
5. Test an annual review due with non-round prices, an unexecutable whole-share order, HOLD closure with bounded residue, an intentionally stale or rejected quote, and confirmed corporate-action split blocking. Verify no false trading instructions.
6. Run the real hourly worker, inspect the action and notification records, verify one delivered notification and no duplicates after a restart. Confirm admin operational warnings and a failed-worker alert.
7. Refresh the browser, sign in again, restart the app (not its DB), check ledger and strategy state unchanged. Rehearse application rollback, recheck health and authentication.
8. The admin must verify an actual **enabled and published** complete strategy with regional/broker/ISA-appropriate eligible listings, not only a seed definition. Do not invent ISINs, eligibility or provider licensing. Without this, v1 is not usable.

## Extra go/no-go checks BEFORE enabling paid customers

- Run genuine checkout, signed webhook, activation, renewal, failed payment, cancellation, refund, idempotency and archived-plan tests in a Wealtharr-owned Stripe test account, then a controlled live-mode verification.
- Use a licensed commercial price and history provider. The Yahoo adapter is unlicensed/unofficial and must not be treated as a paid-launch source. Verify actual symbols, currency subunits, pricing timestamps, dividends/splits and access rights.
- Obtain the necessary UK regulatory/financial-promotion and customer terms/privacy review, company/support/refund details and confirmed market/instrument approvals.
- Verify Cloudflare Turnstile with the owned live hostname and real widget keys, independent email delivery and backups/restore/monitoring on the host.
- Confirm launch dashboard status and run the commercial preflight against real stored settings; neither a typed checkbox nor a passing synthetic check replaces operator evidence.
- Only after all commercial evidence passes may an operator enable paid checkout and search indexing. Until then keep them disabled even if the beta runs.

## Release boundary

- No optional read-only brokerage sync, no additional strategy catalogue, no redesign, no new analytics features in v1. These may be revisited only after real user feedback.
- Do not reopen superseded #74 after its complete rebalance changes are integrated here. Do not produce another feature PR after this release; use issue reports and targeted bugfix PRs for verified defects.
- Record actual release SHA, server deployment timestamp, operator, URL, smoke output, test-user evidence, backup snapshot, restore drill and Stripe/provider/legal sign-offs before making a launch claim.

## What automation cannot prove

Green CI and the new HTTP smoke check do not prove a live brokerage fill, commercially licensed market data, working DNS/host updates, payment settlement, signed legal advice, or real inbox delivery. These require the people who control the deployment and provider accounts; no code can substitute for them.
