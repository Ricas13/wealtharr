# Billing and entitlements

Stripe handles payment collection; Plan and Subscription records control application access.

The canonical entitlement service loads the current plan and enforces limits server-side. Free, Investor and Pro are seed data rather than conditional branches scattered through the application.

Initial seed:
- Free: 1 active strategy, in-app actions, history, reconciliation, resume, community
- Investor: 3 active strategies plus Email / Discord and analytics/comparison entitlements
- Pro: unlimited active strategies plus the same currently implemented notification and analytics features

Future features are not advertised through entitlements until their user-facing implementation exists.

## Pricing model

Plan pricing is stored in plan_prices by plan, ISO currency and cadence. Each active price record may hold its own Stripe Price ID. This allows GBP, USD, EUR or other configured prices without pretending that a converted display amount is a real Stripe price.

The older default amount fields on plans remain administrative/default metadata, while checkout always resolves an active plan_prices record for the requested currency and cadence.

Stripe webhooks resolve the canonical plan from the actual Stripe Price ID and subscription metadata. Application access is derived from the local subscription and plan entitlement records, not from scattered Stripe checks.

Administrators (`users.role = ADMIN`) are entitlement super-users: `loadEntitlementsWith` returns an unlimited snapshot with every feature and channel, ignoring the plan limits of their subscription (a real paid or store-billed subscription is still shown and manageable in Settings). The plan slug `admin` is reserved and cannot be created as a plan. It is an entitlement bypass only and applies to every plan-resolution path, including the hourly `enforceStrategyEntitlements` pass. Demoting an admin re-applies their subscription plan on the next enforcement pass.

Administrators may additionally start, switch to and preview strategies whose definition is disabled for customers (`EntitlementSnapshot.includeDisabledStrategies`, true only in `adminEntitlementSnapshot()`; never taken from request input). This does not relax any release gate: the strategy still needs a PUBLISHED, in-window version (never a DRAFT) and the market/mapping check still applies. Instances started this way carry `strategy_instances.admin_disabled_preview`; once the owner is no longer an admin, `enforceStrategyEntitlements` pauses them while the definition remains disabled, and they cannot be reactivated. Unmarked instances of a definition disabled later keep running as before.
