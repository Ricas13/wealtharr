# Three additional US reference portfolio drafts

These are **code-defined research versions** only. Seeding installs disabled draft versions; no market mappings, verified execution advice, source-rights sign-off or UK ISA substitutions are implied. The platform's market resolver requires each distinct sleeve to have an exact economic-exposure, leverage, country/wrapper and broker match.

## Coffeehouse — US seven-fund reference

- 10% US large-cap blend
- 10% US large-cap value
- 10% US small-cap blend
- 10% US small-cap value
- 10% developed ex-US large cap
- 40% US intermediate Treasuries
- 10% US REITs

Reference: https://portfoliocharts.com/portfolios/coffeehouse-portfolio/ (Bill Schultheis model). Platform convention: annual calendar review; other schedules require reviewed versions.

## Four-fund US asset-class reference — Rick Ferri source, licence not cleared

- 48% total US equities (including small/mid cap)
- 24% total international equities outside the US (including emerging markets)
- 20% US investment-grade aggregate bonds (Treasuries, corporate credit and mortgage-backed bonds)
- 8% US REITs

**Primary author description:** https://core-4.com/classic-core-4-portfolio/. The 80/20 research split is a platform-fixed allocation variant, not a universally mandated allocation. The owner's website at https://core-4.com/ specifically notes that **Core-4 is a registered trademark and for-profit licensing is available**. This draft may NOT be advertised or sold under the trademark before legal/licensing clearance. Portfolio Charts uses a different narrowed underlying representation; this reference deliberately follows the author's broader fund universe.

## Swensen six-asset individual-investor reference

- 30% US total equity
- 15% developed ex-US
- 5% emerging market equity
- 20% US REITs
- 15% US intermediate Treasuries
- 15% US inflation-protected Treasuries (TIPS)

Reference: https://www.bogleheads.org/blog/2021/01/02/david-swensens-portfolio-from-unconventional-success-2020-update/. Do not describe this as Yale endowment's asset allocation. The Treasury maturity convention is provisional until separately source-verified.

## Release blockers

The amounts in `tests/strategy-reference-golden.test.ts` are independently worked arithmetic examples for the **chosen platform reference splits**, NOT independent author-endorsed strategy backtests. Before publication, verify the exact historical methodology, identify broker-eligible real securities for each sleeve, settle currency and calendar conventions, check source rights, attest the reviewed version and pass real full-journey staging tests. Do not populate mappings with superficially similar ETFs just to enable a portfolio.
