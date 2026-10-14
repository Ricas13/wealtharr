# All Weather / All Seasons — unleveraged 30/40/15/7.5/7.5 approximation

## Definition
Explicitly **not Bridgewater's proprietary All Weather risk parity**. This is a widely distributed unleveraged five-asset approximation commonly associated with Tony Robbins / All Seasons and described at https://portfoliocharts.com/portfolios/all-seasons-portfolio/ . This US-reference model uses US large-cap blend rather than substituting global all-cap equity. Portfolio Charts rounds the last two weights to 8% gold / 7% commodities; the unrounded 7.5% / 7.5% variant is deliberately selected and does not claim to reproduce those rounded weights. Weights: 30% US large-cap blend equities, 40% long US Treasury, 15% intermediate US Treasury, 7.5% gold, 7.5% broad commodity index. Do not conflate the model with Bridgewater's volatility-budgeting, leverage or implementation.

## Rebalancing rule
Wealtharr operational convention: review on the configured annual calendar schedule, rebalance to exact fixed targets with zero drift threshold at review. On deposit, purchase underweight sleeves first; on withdrawal, fund cash need by sales. Fee, integer/fractional-share, minimum trade and residual cash handling use the existing shared execution and immutable ledger; the strategy does not invent broker support. Never claim an original author mandated this schedule.

## Instrument requirements
Every distinct economic exposure requires verified exact listing, index coverage, domicile and leverage if relevant, quote/FX, broker, country and tax-wrapper eligibility. No automatic ticker substitution; unsupported combinations stay unavailable.

## Owner-decision list
Product marketing/trademark permissions, country-specific offerings and wrapper restrictions, instrument line approvals and live execution sign-off are separate from method completeness. Never auto-approve them.

## Golden tests
`tests/strategy-group-2-golden.test.ts` independently asserts initial targets, drift transactions and contributions. Relevant execution/ledger/eligibility/regression tests are also required.

Specific risk: inflation, commodity roll yield, Treasury duration, gold tracking and geographic equity coverage vary by instrument. Source weights are not a performance guarantee.