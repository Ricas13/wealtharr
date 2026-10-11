# Portfolio tracker expansion — Wealtharr

**Scope:** Investment bookkeeping and rule-based strategy tracking are different products. Maintain a clear separation.

## Product design

Top-level default is the currently implemented `/app` **My Strategies** dashboard:
existing rule-based plans, due reviews, contributions, exact investment instructions and their authenticated ledger.

Introduce an **optional** account-level **All Holdings** view only for customers who choose to use it. It contains imported
brokerage positions, cash, dividends and historical transactions, including holdings outside a strategy. It must
not be required to create or use a strategy. Put detailed exposure, goals, dividends and broker sync under the
optional Portfolio section; do **not** place a new widget for every feature on the landing dashboard.

Proposed navigation, when launched:
- Dashboard — highlights, one next action, graphs and overall progress
- My Strategies — per-strategy positions and rule-specific execution
- All Holdings — optional unassigned investments, connected accounts and income
- Activity — future reviews, notifications and import/reconciliation issues
- Settings — brokerage permissions, syncing and account privacy

Customers may choose whether their global overview includes unassigned holdings. Until explicit FX conversion
is backed by dated/licensed quotes, display values by currency, not as a blended total.

## Crucial accounting boundary

**Do not** insert broker-synced trades directly into `ledger_events`, `strategy_states` or `actions`.
`ledger_events` is the audited strategy ledger; imported provider data is observational evidence, not
user-confirmed execution or an implicit allocation rule. A strategy's rebalance calculations never query
unassigned imported holdings.

Design an independent, user-scoped observation model in a future migration:
- `broker_connections`: owner, provider, connection state, explicitly READ_ONLY permission proof,
  encrypted credentials/reference, sync freshness and revocation.
- `broker_accounts`: external account IDs namespaced by provider and connection, wrapper, base currency,
  `user_id`; default private/visible only after owner consent.
- `broker_positions`: provenance, provider instrument ID/ISIN/exchange/ticker, quantity, market value,
  native currency, observed timestamp, immutable snapshot ID.
- `broker_cash`, `broker_transactions`, `broker_income`: independently versioned source-backed records
  and idempotency keys. Never infer missing dividends, FX, unit quantities, splits or fees.
- `strategy_import_links`: explicit mapping `broker_account + instrument + strategy_instance_id`,
  approved and reversible by the user. A link enables **comparison and reconciliation only**. Moving
  observed transactions to confirmed strategy ledger requires a separate reviewed, idempotent action.
- `portfolio_view_settings`: opt-in to show other holdings on global dashboard. Default off.

Enforce owner isolation through parameterized ownership checks on every read/write; least-privilege
runtime DB roles, encrypted sensitive fields, no key logging, no browser-side provider calls.
Accounts from the same broker may have mixed holdings and multiple currencies. Never classify by ticker alone,
never assume an entire brokerage account belongs to 9Sig, and never sum the same imported/linked holding
twice in whole-portfolio metrics.

## Brokerage priority (UK first)

1. **Manual CSV statement import and preflight**: Trading 212 first. File parsed and previewed before
   persistent write. Exact transaction IDs, instrument identities, currency, fees, duplicates and missing
   history must be reconciled. Invalid rows are quarantined, not silently accepted.
2. **Official Trading 212 read-only key pilot**, with user-generated granular keys limited to
   Account data, Metadata, Portfolio and only the History scopes required for the requested views.
   The official public API is beta and currently covers Invest and Stocks ISA; it also exposes
   order *write* endpoints, which the integration must never call. Mask keys in responses and logs,
   encrypt at rest, support revoke/disconnect, and avoid prompting for trading permissions.
3. **Multi-broker adapter** via e.g. SnapTrade when required, and only with provider-commercial
   terms reviewed. SnapTrade connections should explicitly use `connectionType=read`; never
   `trade-if-available` or `trade`. Validate real ISA support before claiming it: support documentation
   has described Trading212 Invest-only limits even though the official T212 API supports ISA.
4. Backfill history only through consent and verified cursor-based pagination; schedule idempotent
   daily sync with error/backoff/rate limits, freshness banners and per-account failure handling.

Official reference:
https://docs.trading212.com/api
https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key
https://docs.snaptrade.com/docs/broker-access-guide
https://docs.snaptrade.com/docs/trading-with-snaptrade

## Feature priorities

| Feature | Priority | Meaning | Release guard |
| --- | --- | --- | --- |
| Performance vs licensed benchmark | Existing | Estimated flow-adjusted history only | Never label estimated return exact TWR |
| Portfolio composition by strategy | PR 26 | Observed value by same-currency strategy | All open strategies valued, no FX guessing |
| Historical cash income | PR 26 | Recorded dividends/distributions/interest in strategy ledger | Do not imply untracked brokerage income or forecasts |
| Read-only brokerage + CSV | First expansion | All Holdings isolated from strategy ledger | Consent, account-scoped IDs and import preview |
| Consolidated asset allocation | After integration | Instrument/sector/geography and accounts | Reliable instrument mapping; distinguish ETFs' look-through |
| Verified TWR and XIRR | After reconciliation | Complete external flows, fees, dividends and valuation checkpoints | Fail closed on missing history/FX; independently golden-tested |
| Dividend calendar and projections | Later | Actual vs announced future payments | Separate verified receipts from estimates |
| Custom targets and FIRE | Later, optional | Scenario projections, not trading instructions | User-controlled assumptions and explicit uncertainty |
| Alerts, drift and price targets | Later | Optional notification preferences | Source freshness, dedupe and strategy isolation |

Admin GUI shall control provider credentials/enablement, sync cadence/limits, available imports,
feature gating and retention settings. Infrastructure secrets, bootstrap encryption keys, network
and Docker deployment parameters remain environment/Compose-only.

## Ready-for-public pilot acceptance

- Security review including SSRF, CSRF, permission scopes, key rotation/revocation, PII export and deletion.
- Real paper/test broker key; negative test proves **no** write methods or unassigned strategy mutations.
- Broker sync corruption/missing fields must stop and alert; no inferred quantities.
- Immutable source IDs, reconciled cash movements, corporate actions, mixed-currency and duplicate imports.
- Full valuation/TWR/IRR independent reference tests; licensed market and FX data.
- Disclosure/privacy/DPIA/commercial rights and UK regulatory review before paid availability.

**Status 2026-10-11:** This document is the implementation contract and release sequence. **No brokerage
linking, auto-sync, API credential storage, CSV import, precise TWR or IRR engine has been released by PR 26.**
