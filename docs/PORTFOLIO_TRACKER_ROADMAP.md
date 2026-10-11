# Strategy-scoped read-only brokerage verification — Wealtharr

**Owner clarification (2026-10-11):** Read-only broker connectivity must serve **only the customer's selected Wealtharr strategies**. Other investments in the broker account should be ignored. This is **not** a portfolio aggregator or an "All Holdings" feature.

## Desired customer journey

1. The user opens a specific strategy tab, e.g. **My Strategies → 9Sig → Connect broker**.
2. Wealtharr explains the actual broker-level data scope and requests the minimum read-only access permitted by the provider. The user selects a connected brokerage account.
3. The user explicitly selects **which investments or transactions belong to the strategy**. Prefer a dedicated brokerage account if available.
4. Wealtharr previews matched positions, transaction lots, cash attributed to the strategy, recent activity, and any discrepancies. No unrelated holdings are shown.
5. The user approves a one-time matching map and may edit/revoke it later.
6. Subsequent read-only syncs help verify the recorded holdings/transactions and make reconciliation proposals. **No external activity silently enters the immutable strategy ledger or triggers orders.**
7. The strategy tab presents the verified positions, broker-vs-ledger differences and sync freshness. A customer can always continue in manual mode without broker access.

Do **not** create global account-wide tracking, unrelated-holding pages, portfolio-wide dividend calendars, full-account performance charts, unrelated stock import, or goals/FIRE features as part of this requirement.

## Read-only permission nuance

Trading/broker APIs often grant permissions for an **entire account**, even if Wealtharr is interested in one strategy. Do not promise that the API can restrict visibility to a subset of ETFs unless that broker specifically supports the restriction. Depending on provider behaviour, the sync adapter may receive other holdings briefly while filtering.

Apply data minimisation: avoid requesting unneeded endpoints; process and filter to strategy-linked instruments/transactions within the trusted backend; do not retain unrelated holdings, transmit them to a client, include them in metrics or log them. Display a concise permission disclosure before consent.

**Never** request, store or exercise permissions to place, amend, cancel or route orders. Write-API methods must be rejected by the connector's allowlist, and controls must be backed by tests.

## Mixed-use account example

A user owns 30 units of an ETF within a Wealtharr 9Sig strategy and another 20 units of the **same ETF** as a separate personal investment, all in one broker ISA.

A broker's account-level position endpoint may return **50 units**. Wealtharr must not import 50 into 9Sig. It must identify the 30 units through explicit broker transaction/lot assignment or a user-confirmed quantity and supporting history. If the mapping is ambiguous, the result is **needs reconciliation**, not an automatic 30/50 split.

Two strategies holding the same ticker must have distinct approved allocations to external transaction/lot identifiers and cannot double-count broker positions. Broker cash can also be shared, so account cash is not automatically allocated to either strategy. Strategy attribution must survive ticker changes, splits, dividends and currency conversions; otherwise fail closed.

## Accounting and safety boundary

- Existing immutable `ledger_events`, `strategy_states` and `actions` remain authoritative until separately user-confirmed and audited reconciliation of imported evidence.
- A provider observation is **not** an executed Wealtharr trade, an approved contribution, a price with valid licensing, or a user-approved rebalance.
- Retain only the strategy-scoped provider evidence necessary to substantiate matched positions and discrepancies: provider, external IDs, strategy mapping, effective timestamps, currency, confidence/freshness.
- Per-user/per-strategy scope checks on every query and API; no cross-account bleed. Encrypt provider secrets at rest; no credentials or unrelated holdings in client responses, error messages or application logs.
- Missing/broken pagination, stale provider data, API changes, incomplete historical fills, missing FX or overlapping matching lots → mark stale/ambiguous, preserve previous confirmed state and prompt the user to review.
- A disconnected broker doesn't stop manually managed strategies or remove historical user ledger events.
- Account deletion/export and retention must cover brokerage connections, consent and retained scoped evidence.
- No blending of currency-denominated values without independently verified dated FX prices. No invented holdings or double-counted aggregate balances.

## Engineering sequence

1. **Strategy-scoped matching model.** Add consent-managed broker connections, connection-to-strategy association and independently recorded scoped observations. Save only user-approved strategy-to-transaction/lot/instrument mappings. Do not create account-wide holdings analytics.
2. **CSV pilot.** Preview a Trading 212 statement inside a selected strategy. Let the user choose exact relevant trades; reject duplicates and missing currency/fees, inspect corporate actions; import observation first, not ledger.
3. **Read-only Trading 212 API pilot.** Confirm current Invest/Stocks ISA support and least-privilege permissions against provider documentation. Handle account/token revocation, encryption, sync freshness, rate limits, errors and historical completeness; disallow trading endpoints by method and path.
4. **Within-strategy UI.** Small **Connected broker** section on the strategy detail page: connection state, last sync, matched holding quantities, observed market value, evidence provenance, mismatch banner, and optional **Review differences** action. No extra top-level navigation and no "Other Holdings" list.
5. **Reconciliation workflow.** User confirms imported activity or quantity adjustments with explicit audit trail and idempotency key; ensure any recalculation uses only confirmed strategy ledger evidence.
6. **Independent testing.** Test same-symbol personal holdings, multi-strategy overlap, partial transactions, dividends/reinvestments, cash allocation, FX, fees, sync retries, deletion, cross-user isolation and refusal of all trading writes. Golden-test any return measures against reconciled cash flows.
7. **Admin GUI.** Provider enablement, limits, frequency, health, encrypted provider settings and per-provider features in Master Admin. Docker-only encryption bootstrap stays in deployment configuration.

## What PR #26 delivers

PR #26 introduces an original Snowball-inspired **strategy dashboard layout**, data-backed allocation across tracked Wealtharr strategies where all values share a currency, and displayed **recorded** dividends/interest from the strategy ledger only. It does **not** integrate broker accounts, request read-only credentials, import unassigned holdings or implement account-wide Snowball analytics.

**Tracking:** [Issue #27 — Strategy-scoped read-only brokerage verification](https://github.com/Ricas13/wealtharr/issues/27). Keep paid launch/indexing gates disabled until current independent financial verification and UK privacy/regulatory checks are complete.
