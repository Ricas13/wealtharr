# Paid private beta — verification evidence and blockers (17 October 2026)

## Verdict

**NO-GO for live paid customers.** This document records checks performed from GitHub, repository source, connected-account listing and public UK regulatory materials. No production host access, real Stripe Wealtharr account verification, production restore or signed legal advice is implied.

## Stripe

- Source `src/domain/commercial-launch.ts`: `paidCheckoutBlockers` rejects live checkout when configuration checks fail; these checks are syntactic, not external service proof.
- The only currently available connected Stripe context was named **CaptainFin**, in live mode. That connection was not used to read or alter payment data and cannot safely establish a Wealtharr-owned Stripe configuration.
- No verified test-mode evidence against a Wealtharr-owned Stripe account was available for checkout, activation, renewal, failed collection, refund, cancellation, duplicated/out-of-order webhooks and durable entitlement reconciliation.
- **BLOCKED:** confirm intended Wealtharr Stripe account and gain safe test-mode context; obtain authorised controlled live payment testing after green tests and appropriate approvals.

## Strategy and instrument eligibility

- The repository provides published-version, entitlement and instrument-market restrictions, but the historical `docs/STATUS.md` and `docs/STRATEGY_EXPANSION_LAUNCH_GATES.md` expressly do not certify external market mappings or market-data rights.
- No verified real GB/ISA/GBP instrument documentation, broker-specific purchasability or licensed provider contract was produced in this verification.
- **BLOCKED:** supply mapping-by-mapping issuer/broker evidence and independently calculated reference cases for customer-offered strategies. Do not infer substitute equivalence.

## Production recovery

- `docs/ORACLE_PRODUCTION_DEPLOYMENT.md` describes opt-in off-site encrypted restic backups and `scripts/restore-drill.sh` restores to a scratch database.
- `docs/ROLLOUT_AND_ROLLBACK.md` states actual production rollback and restore require host operator action.
- No live off-site snapshot ID, actual restored-table results, RPO/RTO evidence, application rollback rehearsal or current production acceptance artifacts were available.
- **BLOCKED:** real operator restore and rollback drill, preserved report and release-specific smoke test.

## Legal and commercial

- FCA PERG 8.30.5 specifically warns that software generating investment buy/sell/hold signals is generally liable to be investment advice, with a qualification based on user control over parameter selection and input. See https://handbook.fca.org.uk/handbook/perg8 .
- FCA guidance on personal recommendations and financial promotions: https://www.fca.org.uk/publications/policy-statements/ps18-3-perimeter-guidance-personal-recommendations-retail-investments and https://www.fca.org.uk/firms/financial-promotions-adverts .
- Because Wealtharr creates user-specific investment actions, an independent UK specialist perimeter and promotions review is a paid-beta gate even if customers make their own trades.
- Also required: subscription terms/renewal and cancellation wording, privacy/data protection, support/refund details and right to commercial market data. No external professional sign-off was available.
- **BLOCKED:** documented advice with approved scope or documented permissible product restrictions, plus consumer-policy review.

## CI and release

- Latest known main SHA checked: `fdabd14c71d4afe491834273305dba2665c29fa0`, CI passed: https://github.com/Ricas13/wealtharr/actions/runs/38968959888 .
- PR #139 head `504f63a18a2bde3b7877acaaa391c00a2ab8f4c6`: https://github.com/Ricas13/wealtharr/actions/runs/38975205922 failed `tests/db/worker-scale.test.ts` timing assertion 1610.242ms versus 500ms. Its three new release-smoke regression tests passed. Do not merge before exact-head checks pass.
- PR #140 (paid beta contract) CI was in progress on inspection, not yet verified.
- Do not activate live checkout or set verification flags solely from this report. Record real evidence only after checks are actually completed.
