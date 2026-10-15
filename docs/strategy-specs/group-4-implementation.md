# Group 4 tactical strategies — complete code-level methods and market-gated release

Seven immutable methods implement the six requested Group 4 strategy families, with VAA G4 and G12 as separate named variants.

| Strategy | Variant | Immutable signal and review |
| --- | --- | --- |
| 200-day trend | TREND_200_DAILY | 200 consecutive verified daily trading sessions, last close vs simple average; equality exits to bills; monthly completed-calendar-month review |
| Equal risk contribution | RISK_PARITY_ERC_252 | Four-sleeve unleveraged ERC: 252 aligned daily returns, unbiased sample covariance, positive weights; monthly |
| GEM | GEM_CLASSIC | US vs ACWI ex-US 12-month total return; US vs 3-month bills absolute hurdle, US aggregate defensive; monthly |
| Ivy / GTAA | IVY_GTAA5 | Five independent 20% sleeves vs their 10-month SMA; failed or equal sleeves allocated to 3-month bills; monthly |
| PAA | PAA_12_A2 | Twelve risky assets, 13-month SMA momentum and breadth a=2, single IEF-equivalent protective sleeve; monthly |
| VAA Global 4 | VAA_G4 | Weighted 1/3/6/12 momentum, Top 1 / Breadth 1, strongest LQD/IEF/SHY defensive asset; monthly |
| VAA Global 12 | VAA_G12 | Weighted 1/3/6/12 momentum, Top 2 / Breadth 4, original Easy Trading discrete floor rule; monthly |

## Availability and activation

Method-completeness (`releaseStatus: COMPLETE`) is a code claim with spec, golden checks, source-defined exposures and executable engine; it does **not** confirm actual investment availability. Fresh installs seed all seven definitions **disabled**, with published immutable canonical versions. Prior installations with legacy research drafts receive an additional immutable version only when disabled, with no customer instances and no previously published version; no customer ledgers or existing published rules are rewritten.

The global admin Enable action requires an entire compatible, EXACT, operator-approved market and a successful actual calculation from complete licensed provider history. Signals require explicit per-observation certification of total-return dividends/splits, provider corporate-action revision, venue exchange-calendar identity, sequential completed sessions, and provider-confirmed month-end terminal bars. Existing adjusted-only observations default to uncertified. Neither admin input nor a user-provided price can bypass these requirements. Provider contracts and actual fund/broker market mappings are external prerequisites; no default tradable instrument is assumed.

Customer actions use the existing immutable strategy ledger and execution confirmation. Tactical calculations sell excess positions first and buy with actual reconciled cash, recalculating after each reported execution. Unverified sources, missing sessions, stale quotes, ambiguous mappings, inconsistent currencies and unavailable trading lines return `DATA_REQUIRED` or suppress strategy availability. Wealtharr never places brokerage orders automatically.

## Implementation map

- `src/domain/strategy/tactical-math.ts`, `tactical-allocation.ts`, `tactical-engine.ts`: mathematical methods and guarded transaction proposals
- `risk-parity-estimator.ts`, `paa-signals.ts`, `vaa-signals.ts`, `ivy-signals.ts`: independent signal functions
- `src/domain/strategy/catalog/group4-configs.ts`, `src/domain/strategy/group4-exposures.ts`: immutable variants and economic exposures
- `db/migrations/0059_tactical_history_certification.sql`, `src/lib/tactical-history-loader.ts`, `src/lib/price-history-ingest.ts`: historical provider certification
- `src/lib/tactical-enable-preflight.ts`, `src/lib/tactical-release-upgrade.ts`, `src/lib/action-service.ts`: admin and customer lifecycle integration
- `docs/strategy-specs/{trend-200d,risk-parity,dual-momentum,gtaa-ivy,paa,vaa,vaa-g12}.md`: source references, assumptions, cash rules and specific golden cases
- `tests/*golden.test.ts`, `tests/tactical*.test.ts`, `tests/db/tactical*.test.ts`: arithmetic, fail-closed and database integration checks

## External validation that source code cannot fabricate

Passing repository CI does not establish that a market-data vendor is licensed, that its dividends-inclusive histories cover the required sessions, that a broker offers the exact instruments in a particular tax wrapper, that an investor's holdings are reconciled, or that the deployed Wealtharr host is healthy. These are enforced operator prerequisites. Deploy migration and workers, configure provider/licensing through the existing operator controls, verify exact instrument mappings and exercise a real market before enabling in Admin Strategy Studio. This document is not investment advice and does not represent external security or FCA clearance.
