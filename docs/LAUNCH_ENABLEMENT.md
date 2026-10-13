# Launch enablement checklist: 9Sig, HFEA, 60/40, All Weather

Purpose: show, per strategy, what code already provides and what only the owner or an administrator can do. Nothing here is an attestation, a sign-off or a verified instrument. Every identifier (ISIN, ticker, exchange, listing, currency) is for the owner to establish from issuer documents; this file deliberately contains none.

Sourced from code read on `main` at f840e26 (2026-10-12). Items marked **UNVERIFIED** could not be confirmed from the repository (the build environment had no Node, so no test, type check or database run was possible for this change).

## 1. How enabling is gated (in code)

Per version, in order (`src/app/api/admin/strategies/route.ts`):

1. **ATTEST**: records a spec-card path (must match `docs/strategy-specs/<slug>.md`; existence of the file is not checked), a free-text golden-tests location (3 to 300 characters) and the attesting admin. It does not verify anything; a person must have done the review. Any later draft edit deletes the attestation (and migration 0029 does the same for direct SQL edits).
2. **PUBLISH** (draft only): needs the attestation, a customer-publishable engine (`VALUE_TARGET`, `FIXED_ALLOCATION`), valid engine config and canonical rules (`assertCuratedRules`: stored config must equal the code config exactly; 9Sig is `CANONICAL_9SIG_CONFIG`). Refused if the config has `userWeights: true`, or if another published version of the same strategy already has the same effective date. Published versions are immutable.
3. **ENABLE** (`TOGGLE_DEFINITION`): needs an active published version, an attestation, canonical rules again, and `assessStrategyMarket(...)` to find at least one complete market. The check is hard-coded to country `GB`, wrapper `ISA`, currency `GBP`, and counts only mappings that are `EXACT`, enabled, in date, with matching exposure, leverage, direction, trading-line currency, and where the instrument row agrees (`VERIFIED_MARKET_MAPPINGS_SQL`). Two legs resolving to the same trading line or the same exchange/ticker/currency are rejected.

Checks that exist but are **not** proof of tradability: the code states that EXACT is an operator assertion and says nothing about broker availability, licensing or legal status.

## 2. Audit summary (state in code and seed)

| | 9Sig | HFEA | 60/40 | All Weather |
|---|---|---|---|---|
| Catalogue key | `9sig` | `hfea` | `60-40` | `all-weather` |
| Engine | `VALUE_TARGET` | `FIXED_ALLOCATION` | `FIXED_ALLOCATION` | `FIXED_ALLOCATION` |
| Rules in code | `CANONICAL_9SIG_CONFIG`: target `NASDAQ_100_3X_LONG`, initial ratio 0.60, target rate 0.09 per review, contribution ratio 0.50, max cash use 0.90, tolerance 0.01 | 55% `US_EQUITY_3X_LONG`, 45% `LONG_TREASURY_3X_LONG` | 60% `BROAD_EQUITY`, 40% `AGGREGATE_BONDS` | 30% `BROAD_EQUITY`, 40% `LONG_TREASURY`, 15% `INTERMEDIATE_TREASURY`, 7.5% `GOLD`, 7.5% `BROAD_COMMODITIES` |
| Leverage | 3x daily-reset | 3x on both legs | none | none |
| Review | Quarterly, 16:00 cutoff, previous-business-day convention, empty holiday list; no `reviewTimezone` in the canonical config | Quarterly, calendar quarter end, 16:00 America/New_York, empty holiday list | Annual, threshold 0.00 | Annual, threshold 0.00 |
| Spec card | **None** (`docs/strategy-specs/9sig.md` does not exist) | `docs/strategy-specs/hfea.md`: "externally corroborated, not independently certified"; reviewer PENDING | `docs/strategy-specs/60-40.md`: "model convention, not one uniquely authored strategy"; reviewer PENDING | `docs/strategy-specs/all-weather.md`: DRAFT, NOT SIGNED OFF; weights and schedule marked VERIFY; written without the primary source |
| Golden tests | `tests/value-target.test.ts` (engine behaviour, expected values self-computed, not from the author's source); no author-source golden cases | `tests/strategy-reference-golden.test.ts`: £10k initial 5,500/4,500, drift 6,000/4,000 to sell 500 / buy 500, £1,000 contribution 550/450; plus HFEA fill-to-HOLD integration | Same file: £10k initial 6,000/4,000, 7,000/3,000 drift. No on-target, contribution, threshold or rounding cases | Same file: **added in this change** (see section 4). Previously none |
| On a fresh seed: seed state | Definition `enabled=true`; version 1.0 inserted directly as `PUBLISHED`; **no attestation** | Definition `enabled=false`; version 1.0 `DRAFT` | `enabled=false`; `DRAFT` | `enabled=false`; `DRAFT` |
| Disclosure | Seed default text ("Rule calculator for a user-selected strategy...") although the target is 3x leveraged; the catalogue's `LEVERAGE_DISCLOSURE` is attached only to HFEA | `LEVERAGE_DISCLOSURE` | seed default | seed default |
| Instrument mappings | None seeded | None seeded | None seeded | None seeded |

### Exact blockers per strategy

**9Sig**: (1) no spec card, so ATTEST cannot honestly be recorded; (2) no author-source golden cases; (3) it is already `enabled` and `PUBLISHED` without attestation, so Admin > Launch lists a gap and live Stripe checkout refuses until a sign-off exists (`src/lib/strategy-evidence.ts`); (4) EXACT mapping for `NASDAQ_100_3X_LONG`; (5) leverage disclosure on the version is the generic default (legal review); (6) canonical config has no `reviewTimezone` and an empty holiday list (UNVERIFIED how the engine resolves the timezone; see `docs/strategy-engines.md`: strategy timezone, else the user's). Note: the published 9Sig version is immutable, so a changed disclosure needs a new version (a new code-reviewed release).

**HFEA**: (1) human review of `hfea.md` against the original author thread and calendar; (2) independently computed golden cases are present for the three headline cases but the card itself says "independently run golden cases" are still a blocker; (3) EXACT mappings for `US_EQUITY_3X_LONG` and `LONG_TREASURY_3X_LONG`; (4) market-holiday coverage and the 16:00 cutoff are marked as needing independent verification in the card; (5) licensed provider and disclosure/legal review.

**60/40**: (1) human review of `60-40.md` (the card itself says this is a convention, not a uniquely authored strategy); (2) golden cases cover only two scenarios; (3) EXACT mappings for `BROAD_EQUITY` and `AGGREGATE_BONDS` ("country-specific bond exposure definitions" are pending in the card); (4) data/licensing.

**All Weather**: (1) the card is still DRAFT with every weight marked VERIFY and says Bridgewater's All Weather is a different product (the customer-facing text must say so; the catalogue rule text already says "NOT an official, single canonical Ray Dalio product"); (2) human review against the cited source (Portfolio Charts All Seasons, Tony Robbins); (3) EXACT mappings for five exposures, including `GOLD`, `BROAD_COMMODITIES` and `INTERMEDIATE_TREASURY`; (4) the card asks for a "withdrawal" golden case; one planner-level case with negative cash was added (£1,000 out of an on-target portfolio), but whether real callers ever pass negative cash to the planner is UNVERIFIED, so the card requirement is only partly met; (5) data/licensing.

## 3. Verified EXACT mappings required (owner)

Pointer: how to choose and evidence an exact GB / ISA listing is in [uk-instrument-selection-methodology.md](uk-instrument-selection-methodology.md); the operator template is [instrument-verification-checklist.md](instrument-verification-checklist.md).

For every row, the owner must verify product, ISIN, listing/exchange, trading currency (must be GBP for the enable gate), fund currency and that the product's exposure and leverage match the registry definition, against the issuer factsheet and KID/KIID. Do not use a product with a different leverage, duration or index "because it is similar": the resolver and the card rules reject substitution (HFEA card: "Do not substitute TQQQ for UPRO or a 3x 10-year Treasury instrument for TMF").

| Exposure id | Leverage | Direction | Used by | Registry definition |
|---|---|---|---|---|
| `NASDAQ_100_3X_LONG` | 3 | LONG | 9Sig | Nasdaq-100 equities with 3x daily-reset leverage |
| `US_EQUITY_3X_LONG` | 3 | LONG | HFEA | US large-cap equities with 3x daily-reset leverage |
| `LONG_TREASURY_3X_LONG` | 3 | LONG | HFEA | Long-duration government bonds with 3x daily-reset leverage |
| `BROAD_EQUITY` | 1 | LONG | 60/40, All Weather | Diversified global or broad-market equities |
| `AGGREGATE_BONDS` | 1 | LONG | 60/40 | Broad investment-grade bond market |
| `LONG_TREASURY` | 1 | LONG | All Weather | Long-duration government bonds |
| `INTERMEDIATE_TREASURY` | 1 | LONG | All Weather | Intermediate-duration government bonds |
| `GOLD` | 1 | LONG | All Weather | Physical-gold-backed exposure |
| `BROAD_COMMODITIES` | 1 | LONG | All Weather | Diversified commodities basket |

Region and wrapper combinations the code supports:

- The enable gate and Admin > Strategies readiness check only `GB` / `ISA` / `GBP`. This is the minimum for ENABLE.
- The customer "new strategy" page resolves `ISA` for a GB user and `TAXABLE` for any other country (`src/app/app/strategies/new/page.tsx`), with the user's base currency.
- The admin and customer UIs also offer `SIPP` and `GIA`/`TAXABLE` as wrapper values (`src/components/AdminEditors.tsx`, `StrategyActions.tsx`, `CreateStrategyForm.tsx`). Wrapper strings are free text compared exactly, and `GIA` versus `TAXABLE` is inconsistent between components (UNVERIFIED which a given customer flow produces). Each (country, wrapper) pair needs its own mapping rows; a mapping for ISA does not cover SIPP.
- Optional `broker` and `preferredCurrency` can narrow a mapping; a mapping with a broker only resolves for that broker. The ENABLE gate and the Admin readiness check pass no broker, and `resolveMapping` rejects broker-specific mappings when the request has none (`src/domain/instruments.ts`), so the mappings that satisfy the ENABLE gate must be broker-less.

Import template (the import script rejects blank ISIN, name, ticker, exchange, timezone, currency and wrapper, so a pre-filled CSV with blanks cannot be validated; fill the blank columns, then save as CSV with exactly this header):

```
isin,name,exposure,leverage,direction,fundCurrency,ticker,exchange,currency,timezone,country,wrapper
```

| isin | name | exposure | leverage | direction | fundCurrency | ticker | exchange | currency | timezone | country | wrapper |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (owner) | (owner) | `NASDAQ_100_3X_LONG` | 3 | LONG | (owner) | (owner) | (owner) | GBP | (owner IANA, e.g. exchange timezone) | GB | ISA |
| (owner) | (owner) | `US_EQUITY_3X_LONG` | 3 | LONG | (owner) | (owner) | (owner) | GBP | (owner) | GB | ISA |
| (owner) | (owner) | `LONG_TREASURY_3X_LONG` | 3 | LONG | (owner) | (owner) | (owner) | GBP | (owner) | GB | ISA |
| (owner) | (owner) | `BROAD_EQUITY` | 1 | LONG | (owner) | (owner) | (owner) | GBP | (owner) | GB | ISA |
| (owner) | (owner) | `AGGREGATE_BONDS` | 1 | LONG | (owner) | (owner) | (owner) | GBP | (owner) | GB | ISA |
| (owner) | (owner) | `LONG_TREASURY` | 1 | LONG | (owner) | (owner) | (owner) | GBP | (owner) | GB | ISA |
| (owner) | (owner) | `INTERMEDIATE_TREASURY` | 1 | LONG | (owner) | (owner) | (owner) | GBP | (owner) | GB | ISA |
| (owner) | (owner) | `GOLD` | 1 | LONG | (owner) | (owner) | (owner) | GBP | (owner) | GB | ISA |
| (owner) | (owner) | `BROAD_COMMODITIES` | 1 | LONG | (owner) | (owner) | (owner) | GBP | (owner) | GB | ISA |

Constraints the importer enforces (`src/domain/instrument-import.ts`): valid ISO 6166 ISIN check digit; exposure must be in the registry; leverage a positive number (default 1); direction LONG/SHORT (default LONG); 3-letter currencies; 2-letter country; `ticker`, `exchange`, `timezone`, `wrapper` required; no duplicate `isin|exchange|ticker|country|wrapper`. One row per wrapper per product. Trading currency GBP is needed for the enable gate; a product that trades only in USD or EUR will not satisfy `{GB, ISA, GBP}`.

Importer limitations: it stores rows as `CANDIDATE` only, which the resolver ignores; its coverage report is built from `RESEARCH_STRATEGIES` allocations only, so it does not list 9Sig's `NASDAQ_100_3X_LONG`; it does not set the provider symbol (set that on the trading line in Admin > Instruments, as the market-data worker needs it; UNVERIFIED how the worker maps a provider symbol when it is blank).

## 4. Per-strategy checklist

Legend: **Code** = done in this repository; **Owner** = only a human can do it.

### 9Sig (`9sig`)
- [x] Code: engine, canonical config, curated-rules guard, behavioural tests (`tests/value-target.test.ts`, `tests/curated-release.test.ts`).
- [ ] Owner: write and review a spec card `docs/strategy-specs/9sig.md` from the author's primary source (the catalogue points at https://jasonkelly.com/2017/01/how-my-signal-system-works/ for 3Sig/6Sig; the 9Sig source must be identified by the owner). Code PR needed for the card file; the card must not guess parameters.
- [ ] Owner: independently computed golden cases from the source's own worked examples (current tests use self-computed values).
- [ ] Owner: ATTEST path `docs/strategy-specs/9sig.md`; golden tests location `tests/value-target.test.ts` (plus whatever file holds the independent cases).
- [ ] Owner: EXACT, broker-less mapping for `NASDAQ_100_3X_LONG`, GB / ISA / GBP (needed so customers can act on 9Sig actions; the enable gate never ran for it).
- [ ] Owner: review the version disclosure (currently the generic default for a 3x product).
- [ ] Owner: resolve that 9Sig is already enabled and published without an attestation (decide whether to disable it in Admin until the card is signed; this is a business decision, not changed here).

### HFEA (`hfea`)
- [x] Code: engine, canonical config, leverage disclosure, spec card draft with arithmetic, golden cases, fill-to-HOLD integration test.
- [ ] Owner: review `docs/strategy-specs/hfea.md` against the original author's thread (post #3350 and the quarterly calendar), then record a named reviewer and date.
- [ ] Owner: independent confirmation of the golden arithmetic and of the quarter-end cutoff and holiday handling.
- [ ] Owner: EXACT mappings for `US_EQUITY_3X_LONG` and `LONG_TREASURY_3X_LONG`, GB / ISA / GBP. UK retail availability of products with these exact exposures and leverage is UNVERIFIED; the research catalogue itself warns that "UK ISA/UCITS substitutions must not be assumed equivalent".
- [ ] Owner: ATTEST path `docs/strategy-specs/hfea.md`; golden tests `tests/strategy-reference-golden.test.ts`.

### 60/40 (`60-40`)
- [x] Code: engine, canonical config, golden cases (initial and one drift).
- [ ] Owner: review `docs/strategy-specs/60-40.md` (convention card; variant is explicit: 60/40 annual, threshold 0) and sign it.
- [ ] Owner: decide exactly what `BROAD_EQUITY` and `AGGREGATE_BONDS` mean per country and verify the product for each.
- [ ] Owner: ATTEST path `docs/strategy-specs/60-40.md`; golden tests `tests/strategy-reference-golden.test.ts`.
- [ ] Code (optional follow-up): extra golden cases (contribution, tolerance, rounding) like those added for All Weather.

### All Weather (`all-weather`)
- [x] Code: engine, canonical config, golden cases added in this change (initial, rounding, on-target, equity-heavy, bond-heavy, deposit, zero-threshold, tolerance edge).
- [ ] Owner: verify each weight and the exposure definitions against the cited sources, replace the VERIFY items in `docs/strategy-specs/all-weather.md`, set SIGNED OFF with name, date and source URL/date.
- [ ] Owner: confirm the annual/zero-threshold convention is stated as a platform convention (the card says the source may only say "periodically").
- [ ] Owner: EXACT mappings for five exposures (note `GOLD` and `BROAD_COMMODITIES` have wrapper and tax implications flagged in the catalogue risks).
- [ ] Owner: ATTEST path `docs/strategy-specs/all-weather.md`; golden tests `tests/strategy-reference-golden.test.ts`.
- [ ] Owner: ensure customer-facing text states this is not Bridgewater's levered risk-parity product.

## 5. Admin steps, in order (once the owner's evidence exists)

1. **Admin > Settings > Market data**: configure the licensed provider (base URL and token) per `docs/market-data-provider-contract.md`. Adjusted-history storage is only needed by the momentum engines, which are not part of these four strategies (UNVERIFIED whether any of the four needs stored history for reviews); turn it on only when the contract allows it (`MARKET_DATA_HISTORY_ADJUSTED_LICENSED`).
2. **Admin > Instruments**: create the instrument (ISIN, exposure, leverage, direction, fund currency), then its trading line (ticker, exchange, currency, exchange timezone, provider symbol, effective-from), then an **EXACT** regional mapping (exposure, leverage, country GB, wrapper ISA, preferred currency GBP, trading line UUID, effective-from). On current `main` this form writes `EXACT` directly; there is no promote step.
   - Candidate path: `scripts/import-instruments.ts <file.csv>` validates and `--apply` stores `CANDIDATE` rows. A verify-and-promote screen for candidates is **not in `main`** (pending PR #38, GitHub repo Ricas13/wealtharr, branch `origin/wealtharr-promote-candidates`; the older `origin/claude/phase2-instrument-import` is the importer already on `main`). Until it merges, candidates cannot be promoted from the UI. When that PR merges, the manual mapping form creates CANDIDATE only and the admin path becomes create candidate -> Verify/Promote.
3. **Admin > Strategies**: confirm each strategy's readiness row shows a complete market (all legs mapped) and "rules match".
4. **ATTEST** the draft version (spec-card path and golden tests path from section 4). Only after a human has signed the card.
5. **PUBLISH** the draft (needs step 4).
6. **ENABLE** the strategy (needs steps 2 to 5 for GB / ISA / GBP). 9Sig is already enabled and published in the seed, so the toggle gate never ran for it; for it, ATTEST remains (it records the sign-off that Stripe checkout and Admin > Launch check), and the EXACT mapping is needed so customers can act on its actions, not to pass a gate.
7. **Admin > Launch**: confirm no customer strategy is listed without sign-off.

## 6. Data provider and licensing (owner)

- Provider contract for current quotes and, where adjusted history is stored, daily adjusted closes: `docs/market-data-provider-contract.md`. Contract rights to display and store each instrument's data are "Needs people" in `docs/STATUS.md`.
- Quotes for the exact listed products in the mappings (the provider symbol must match the trading line's listing and currency).
- Exchange calendars and holiday lists: the HFEA and 9Sig configs ship `marketHolidays: []`; per `docs/strategy-engines.md` this should come from a licensed or versioned calendar before relying on exact market-session dates. Changing it needs a new strategy version.

## 7. Legal and regulatory review (from `docs/STATUS.md`)

All listed as "Needs people" or open there; none is done by code:

- Independent UK review: FCA perimeter, financial promotions, consumer terms, GDPR, data licensing, tax presentation.
- Strategy-specific disclosures (leverage, volatility decay): HFEA has catalogue wording; "wording still needs legal review"; 9Sig's disclosure is the generic default.
- Methodology rights and brand/name clearance (for example the card for HFEA lists "legal and branding review").
- Commercial data and licensing rights.
- Broker/wrapper eligibility, ISA/SIPP eligibility and broker restrictions are operator assertions to prove (STATUS: "Operator must prove actual tradability, ISIN/ticker accuracy, ISA/SIPP eligibility and broker restrictions").
- Operational prerequisites that also gate real revenue: live Stripe, email, hosting, backups and restore, security review.

## 8. What this change does and does not do

Does: adds hand-derived All Weather golden cases and this checklist. Does not: change any gate, seed, strategy rule or version; record or imply any attestation; add any instrument, ISIN or ticker.
