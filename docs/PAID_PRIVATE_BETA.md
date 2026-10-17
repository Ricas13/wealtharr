# Wealtharr — paid private beta release contract (17 October 2026)

## Decision

Owner-selected target: **invitation-only private beta with live GBP Stripe subscriptions**. This is a release *target*, not authorisation to switch on live checkout before safety verification. No public unrestricted paid launch or automated brokerage execution.

A smaller audience reduces rollout scope but does not relax financial integrity, security, data protection, payment settlement, customer fairness or any applicable legal obligations.

## Beta scope

- Controlled/invite-only customer onboarding; existing account/login and entitlements must remain server-enforced.
- Free access where supported, plus the actual configured Investor/Pro monthly and annual GBP prices. Never assume seed plan prices equal active Stripe Price objects.
- Only complete, published and verified strategies with instrument, region, currency, wrapper and broker-specific eligibility appropriate to each customer. Otherwise show a clear unavailable/data-required state and do not generate fabricated actions.
- Customer records manual fills; Wealtharr does not execute broker trades.
- Plain-language beta limitations, pricing/renewal terms, cancellation and refunds, customer support contact, privacy/terms and suitable risk disclosures visible before payment.

## Non-negotiable paid beta gate

1. Exact deployment SHA passes full CI and is deployed with reversible migrations, backup and demonstrated restore. An unfinished PR or a failed CI run cannot be used as release evidence.
2. Actual-host HTTPS smoke, authentication/email/reset, ownership boundaries and end-to-end member workflow pass using synthetic accounts.
3. Independently checked financial reference examples and exact eligible instruments exist for every strategy offered to testers. No unofficial/unlicensed market data used commercially; verify data-provider rights and live quote behaviour.
4. Wealtharr-owned Stripe account confirmed by operator. Run genuine Stripe **test-mode** cases for checkout, signature validation, subscription activation, renewal, failed payments, cancellation, refunds, out-of-order/duplicate webhooks, reconciliation and entitlement revocation. Then conduct a specifically approved, limited **live-mode** payment verification with verified settlement/receipt and cancellation/refund path.
5. Demonstrate least-privilege access, backup/restore, operational monitoring, worker/notification reliability, and a tested rollback/incident response. Confirm support owner and process for payment disputes.
6. Document applicable UK legal/regulatory, financial-promotion, privacy/consumer terms and market-data licensing review. A checkbox or environment flag is not proof of review.
7. Keep `paidCheckoutBlockers` and `checkCommercialLaunch` fail-closed. Do not weaken their checks because the release is called a private beta. Leave live checkout disabled if any applicable gate remains unresolved.
8. Record deployment commit, reviewer, CI URL, host test outputs, Stripe test and controlled-live evidence, restore result and sign-offs in a dated release record. Do not store credentials or identifiable test-customer details in Git.

## Rollout procedure

1. Invite the internal/operator and a very small set of known testers; verify free and paid customer paths without exposing unrestricted signup.
2. Enable customer payments only after completing the non-negotiable gate, using the existing administrative and environment controls. Operator must explicitly approve any live charge/refund.
3. Observe real webhook reconciliation, refunds, emails, worker runs, quote staleness and ledger invariants after activation; stop new paid signups on material discrepancies.
4. Expand the private cohort only when observed operations remain healthy. Public unrestricted release remains a separate decision.

## Current evidence gaps (not completed by writing this document)

- Previous release documentation explicitly states live payment, market-data rights, external delivery, restore and legal verification remain operator-dependent.
- PR #139 (release redirect smoke hardening) has an exact-head CI failure in `tests/db/worker-scale.test.ts`; do not merge or treat its head as release ready unless repaired and verified.
- Live Stripe test-mode/live-mode evidence and production-host acceptance have not been supplied or demonstrated in this change.

This contract records the owner's rollout intention and constraints; it neither enables charging nor attests that Wealtharr is ready.

## Complimentary trial access while live billing is being set up

The admin customer detail page provides a **Beta access** control. An administrator may grant an existing invited customer Investor or Pro capabilities for 7–180 days, or revoke them. These complimentary entitlements do **not** modify the customer's Stripe subscription, create a paid invoice, or imply that a charge succeeded. The customer account Settings page explicitly identifies the complimentary plan and expiration. Expired/revoked grants fall back to real billing/free entitlements and the scheduled worker pauses over-limit strategies without deleting historical positions or ledgers.

This allows a small cohort to test the working product for weeks or months even if the billing account, licensed feeds, legal review or production payment verification is still pending. It is **not** a workaround to take unverified real payments, and does not make unsupported instruments or unverified actions safe.
