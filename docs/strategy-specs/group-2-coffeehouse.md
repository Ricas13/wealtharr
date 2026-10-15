# Coffeehouse — Bill Schultheis seven-fund US reference

## Definition
Seven holdings from https://portfoliocharts.com/portfolios/coffeehouse-portfolio/ : 10% US large blend, 10% US large value, 10% US small blend, 10% US small value, 10% developed ex-US large-cap blend, 10% US REITs and **40% US intermediate-duration Treasuries**. Bond category is not global aggregate credit; developer-defined geographic/factor labels must be verified with the actual instrument.

## Rebalancing rule
Wealtharr operational convention: review on the configured annual calendar schedule, rebalance to exact fixed targets with zero drift threshold at review. On deposit, purchase underweight sleeves first; on withdrawal, fund cash need by sales. Fee, integer/fractional-share, minimum trade and residual cash handling use the existing shared execution and immutable ledger; the strategy does not invent broker support. Never claim an original author mandated this schedule.

## Instrument requirements
Every distinct economic exposure requires verified exact listing, index coverage, domicile and leverage if relevant, quote/FX, broker, country and tax-wrapper eligibility. No automatic ticker substitution; unsupported combinations stay unavailable.

## Owner-decision list
Product marketing/trademark permissions, country-specific offerings and wrapper restrictions, instrument line approvals and live execution sign-off are separate from method completeness. Never auto-approve them.

## Golden tests
`tests/strategy-group-2-golden.test.ts` independently asserts initial targets, drift transactions and contributions. Relevant execution/ledger/eligibility/regression tests are also required.

This names an explicit US reference variant, not every historical edition of Schultheis's model.