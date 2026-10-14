# Swensen — six-asset individual-investor model

## Definition
The six-asset individual-investor allocation as discussed in https://www.bogleheads.org/blog/2021/01/02/david-swensens-portfolio-from-unconventional-success-2020-update/ and David Swensen's *Unconventional Success*: 30% US total stock market, 15% developed international equities, 5% emerging market equities, 20% US REITs, 15% US nominal Treasuries and 15% US Treasury inflation-protected bonds. Wealtharr selects **intermediate maturity** for the nominal Treasury sleeve as an operational exposure convention; this is **not Yale endowment's institutional allocation**.

## Rebalancing rule
Wealtharr operational convention: review on the configured annual calendar schedule, rebalance to exact fixed targets with zero drift threshold at review. On deposit, purchase underweight sleeves first; on withdrawal, fund cash need by sales. Fee, integer/fractional-share, minimum trade and residual cash handling use the existing shared execution and immutable ledger; the strategy does not invent broker support. Never claim an original author mandated this schedule.

## Instrument requirements
Every distinct economic exposure requires verified exact listing, index coverage, domicile and leverage if relevant, quote/FX, broker, country and tax-wrapper eligibility. No automatic ticker substitution; unsupported combinations stay unavailable.

## Owner-decision list
Product marketing/trademark permissions, country-specific offerings and wrapper restrictions, instrument line approvals and live execution sign-off are separate from method completeness. Never auto-approve them.

## Golden tests
`tests/strategy-group-2-golden.test.ts` independently asserts initial targets, drift transactions and contributions. Relevant execution/ledger/eligibility/regression tests are also required.

Instrument quality, index coverage, REIT risk and precise Treasury maturity must remain explicit.