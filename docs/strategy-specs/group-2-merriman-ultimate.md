# Merriman Ultimate Buy-and-Hold — 2026 ten-sleeve 50/50 equity model

## Definition
Original foundation: https://www.paulmerriman.com/ultimate-buy-and-hold-2026 and https://www.paulmerriman.com/data-tables . This specification selects the **2026 50% US / 50% international 100%-equity** version, rather than the separate 70/30 geographic alternative or any equity/bond mixture. Five US sleeves, each 10%: US large blend, US large value, US small blend, US small value, US REITs. Five international sleeves, each 10%: developed ex-US large blend, developed ex-US large value, developed ex-US small blend, developed ex-US small value, emerging markets. International small/value must be separately evidenced; generic international large blend is not an acceptable stand-in. Entire portfolio is equities: **no invented bond component**. Fund-specific recommendations may change with source releases and are not hardcoded as tickers.

## Rebalancing rule
Wealtharr operational convention: review on the configured annual calendar schedule, rebalance to exact fixed targets with zero drift threshold at review. On deposit, purchase underweight sleeves first; on withdrawal, fund cash need by sales. Fee, integer/fractional-share, minimum trade and residual cash handling use the existing shared execution and immutable ledger; the strategy does not invent broker support. Never claim an original author mandated this schedule.

## Instrument requirements
Every distinct economic exposure requires verified exact listing, index coverage, domicile and leverage if relevant, quote/FX, broker, country and tax-wrapper eligibility. No automatic ticker substitution; unsupported combinations stay unavailable.

## Owner-decision list
Product marketing/trademark permissions, country-specific offerings and wrapper restrictions, instrument line approvals and live execution sign-off are separate from method completeness. Never auto-approve them.

## Golden tests
`tests/strategy-group-2-golden.test.ts` independently asserts initial targets, drift transactions and contributions. Relevant execution/ledger/eligibility/regression tests are also required.

Risk: small-cap, value, international and emerging-market tilts may underperform for decades; execution of ten small orders can suffer from transaction costs. The source's 2026 50/50 allocation publication must be used when evaluating future rule versions.