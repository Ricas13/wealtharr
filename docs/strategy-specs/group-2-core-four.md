# Rick Ferri Classic Core-4 — aggressive 80/20 four-fund variant

## Definition
Primary author https://core-4.com/classic-core-4-portfolio/ defines the four asset categories: US total equity, international total equity incl emerging markets, US listed REITs, and US investment-grade aggregate bonds incl Treasuries, mortgages and corporate bonds. https://core-4.com/classic-core-4-portfolio-allocations/ names an **aggressive growth 80/20 stock/bond variant**, not a universal Core-4 stock/bond ratio. Wealtharr's precise model assigns 48% US stocks, 24% ex-US stocks, 8% US REITs, 20% US aggregate bonds. The split **48/24/8 within equities is an explicit Wealtharr variant**; do not attribute the within-equity weights to the original author's site without confirmation. The commercial Core-4 trademark requires permission for marketed naming.

## Rebalancing rule
Wealtharr operational convention: review on the configured annual calendar schedule, rebalance to exact fixed targets with zero drift threshold at review. On deposit, purchase underweight sleeves first; on withdrawal, fund cash need by sales. Fee, integer/fractional-share, minimum trade and residual cash handling use the existing shared execution and immutable ledger; the strategy does not invent broker support. Never claim an original author mandated this schedule.

## Instrument requirements
Every distinct economic exposure requires verified exact listing, index coverage, domicile and leverage if relevant, quote/FX, broker, country and tax-wrapper eligibility. No automatic ticker substitution; unsupported combinations stay unavailable.

## Owner-decision list
Product marketing/trademark permissions, country-specific offerings and wrapper restrictions, instrument line approvals and live execution sign-off are separate from method completeness. Never auto-approve them.

## Golden tests
`tests/strategy-group-2-golden.test.ts` independently asserts initial targets, drift transactions and contributions. Relevant execution/ledger/eligibility/regression tests are also required.

For marketing before licensing, use the descriptive four-fund model name, not imply endorsement.