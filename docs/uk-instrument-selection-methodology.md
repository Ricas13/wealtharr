# UK instrument selection methodology (GB / ISA / GBP)

Status: procedure and data model, written 2026-10-13. This document contains **no product-level facts**: it names no ISIN, ticker, fund or broker as eligible, available or verified. Every such fact must be established by an operator from the documents described below and recorded as evidence (`regional_instrument_mappings.evidence`, schema in `src/domain/instrument-evidence.ts`).

Nothing here is legal, tax or investment advice. Statements about HMRC and FCA rules summarise the guidance named in section 12 and **must be re-checked by the owner or counsel before launch** (see "Claims that need owner or legal verification").

## 1. Purpose and scope

Strategies describe economic exposures (index family, leverage, direction), never tickers. A *mapping* connects an exposure to one exact trading line for a country, wrapper and optionally a broker. This procedure decides **which listing** to record for an exposure when several could qualify, and what evidence must exist before the mapping may drive trade instructions.

Primary target: country `GB`, wrapper `ISA` (stocks and shares ISA), trading currency `GBP`. Notes for SIPP and GIA are in section 10.

## 2. Exposure specification (written before looking at products)

Write the specification first so the choice is not reverse-fitted to a favourite product. Record, in the verification note or a linked document:

1. **Index family and variant** exactly as the strategy source defines it (provider, index name, price/total/net-return variant).
2. **Region and constituents' domicile** where it matters to the strategy.
3. **Maturity band** for bond exposures (for example the duration bucket named by the source).
4. **Currency and hedge policy**: the trading currency must be GBP (the app has no FX handling). Whether the share class hedges the underlying currency to GBP is a *separate, recorded fact* (`hedged`); the strategy source decides whether hedged or unhedged is faithful. If the source is silent, record that and do not guess.
5. **Leverage and direction**: must equal the registered exposure (`1x LONG`, `3x LONG`, ...). The server refuses a mapping whose instrument leverage or direction differs.

If the exposure is not in `src/domain/strategy/exposures.ts`, stop: promotion is refused (`UNREGISTERED_EXPOSURE`).

## 3. Candidate sourcing (issuer documents)

Candidates are found from issuer documents, not from aggregator pages:

- the issuer's **KID** (key information document; for UCITS the UK/EU retail disclosure document) for the exact share class, or, where no KID exists for a UK-listed product, the issuer **factsheet** for that share class;
- for each document record: the **URL (https only)**, the **retrieval date**, and the **SHA-256 of the exact file retrieved**. The hash proves which bytes were read; a later change at the same URL is then detectable.

Compute the hash locally (for example `sha256sum kid.pdf`, or `Get-FileHash -Algorithm SHA256 kid.pdf`) on the downloaded file, not on a page. Keep a copy of the file in the operator's own records; the platform stores only the URL, date and hash.

A candidate that fails any of sections 4 to 7 is recorded as rejected with the reason, not silently skipped, so the decision is reproducible.

## 4. Listing evidence

From the issuer document, the exchange's own instrument page, or the broker's listing, record for the specific line:

- **exchange code** and **ticker** (these must equal the stored trading line; the server refuses a mismatch);
- the **trading currency**, which must be `GBP` for GB / ISA (a USD or EUR line of the same fund is a different trading line and is not acceptable here);
- optionally the **SEDOL** (7 characters);
- the **ISIN**, recorded on the instrument and checked for format and check digit by the server. The ISIN identifies the security, not the line: the same ISIN trades in several currencies on one exchange, so the (exchange, ticker, currency) triple is what the evidence pins.

## 5. ISA eligibility evidence

Record `isaEligibility = { basis, sourceUrl, checkedAt }`, where `basis` is one of:

| basis | meaning |
|---|---|
| `LISTED_ON_RECOGNISED_STOCK_EXCHANGE` | the operator relied on the investment being admitted to trading or listed on a recognised stock exchange |
| `UCITS_OR_AUTHORISED_FUND` | the operator relied on the product being a UCITS or other qualifying authorised fund |
| `OTHER_DOCUMENTED` | another qualifying basis, explained in the verification note |

`sourceUrl` is the https URL of the authority relied on (the HMRC/GOV.UK guidance page, the exchange's recognition list, or the issuer's regulatory status statement) and `checkedAt` is the date it was read. The GOV.UK guidance reviewed for this procedure is "Stocks and shares investments for ISA managers" (GOV.UK guidance, page checked via search result 2026-10-13; the full page text was not retrievable in the build environment, so the owner must read it). As summarised there, shares qualify when officially listed on, or admitted to trading on, a recognised stock exchange; the guidance also covers qualifying funds. **ISA eligibility is also a property of the account provider's own rules**: a provider may offer fewer investments than HMRC permits.

## 6. UK retail availability

- UK retail investors are generally sold UK-recognised funds and ETFs that carry a UK-compliant KID (the FCA's rules for PRIIPs and UCITS retail disclosure). The platform requires a KID or factsheet URL, date and hash but **does not decide whether a product is lawfully marketable to retail clients**.
- US-domiciled ETFs are generally not available to UK retail clients because they lack the required UK/EU KID. Treat a US-domiciled ETF as unavailable unless the broker's own list shows it and the operator has documentary evidence; record `domicile`.
- A fund being in the ISA-eligible class does not make it purchasable at a given broker.

## 7. Per-broker purchasability evidence

If the mapping names a broker, record `brokerSnapshot = { broker, source, capturedAt, fractionalSupported? }`:

- `source` describes where the information came from (for example "instrument list export downloaded from the broker's website" or "instrument page in the broker's app"), and `capturedAt` is the date.
- The snapshot must name the same broker as the mapping.
- `fractionalSupported` is recorded when the snapshot shows it. Whole-share purchase minimums are not modelled; the strategy flow works with the quantity the user enters.

A mapping with no broker (`broker = NULL`) is broker-agnostic. It resolves for every broker (existing behaviour, unchanged) **and proves nothing about purchasability at any of them** unless a dated broker snapshot is also recorded (section 11).

## 8. Deterministic tie-break

When more than one candidate satisfies sections 2 to 7, choose by this ordered rule so the outcome does not depend on who reviews:

1. Exact specification match, including hedge policy where the source states one (a candidate that deviates is excluded, not ranked).
2. Lowest **TER** (`ter`, decimal fraction string; the document's own figure).
3. **Domicile** (`domicile`): ordered alphabetically by ISO 3166 code. This is only a neutral deterministic key; the platform expresses no preference for any domicile and makes no tax claim about domicile.
4. **Accumulating before distributing**, because the platform's ledger records trades and cash contributions and does not model dividend income (the choice carries no tax implication in this document).
5. **Fund size** (larger first), from the document's own dated figure.
6. Alphabetical ISIN, so the result is total and reproducible.

Record the ranking and which rule decided in the verification note. If two candidates remain equal through rule 5 the ISIN decides; the resolver separately refuses to guess between two EXACT mappings pointing to different trading lines (`AMBIGUOUS_MAPPING`).

## 9. Re-verification and end of life

- Re-verify each EXACT mapping at least every **6 months** and whenever the issuer publishes a new KID, the index provider announces a change, the fund merges, closes or changes share class, or the broker changes its list. Re-verification re-reads the documents and records a new snapshot.
- On delisting, closure, index change or loss of eligibility, set `effective_to` on the mapping and trading line to the last valid date and disable the mapping. Do not edit the evidence in place to look current; the audit trail keeps the original promotion event.
- Existing rows promoted before evidence existed have `evidence = {}`. They are **not** demoted by this change, but they carry no recorded documents and should be re-verified through a new candidate when practical.

## 10. SIPP and GIA notes

- **SIPP**: investment rules come from the pension provider and HMRC pension rules, not the ISA rules above. A SIPP mapping needs its own wrapper value, its own eligibility source, and a broker snapshot from the SIPP product. This platform's evidence requirement (GB / ISA only) does not yet extend to SIPP; the optional evidence fields are still validated if supplied.
- **GIA**: no HMRC product-eligibility test applies, but retail availability (section 6) and broker purchasability (section 7) still do.

## 11. What the platform records as "verified", and what it never claims

**Verified means:** an MFA-protected administrator confirmed, on a date (audit event time), the five-item checklist for one mapping (exposure, leverage, direction, country, wrapper, optional broker) against the recorded documents, and the server validated that the evidence object is complete and consistent with the stored trading line. The audit event stores the evidence and its SHA-256.

**The platform never claims:**

- that the product can be bought at any broker, now or later (a `broker=NULL` mapping resolves for all brokers but is only a stored assertion; only a dated snapshot is evidence, and even that is a point in time);
- tax treatment of any holding, or that an ISA allowance, wrapper rule or provider rule is satisfied;
- suitability, advice or recommendation for any person;
- that documents or hashes were independently checked by the platform: it cannot fetch or compare them.

## 12. Primary sources (names; owner to re-check)

- GOV.UK, "Stocks and shares investments for ISA managers" (HMRC guidance) at gov.uk/guidance/stocks-and-shares-investments-for-isa-managers.
- GOV.UK ISA overview pages for individuals ("Individual Savings Accounts (ISAs)").
- FCA Handbook COBS rules on PRIIPs key information documents and UCITS key investor information, and the FCA's published PRIIPs/KID guidance pages. **Exact page URLs were not retrievable in the build environment and are deliberately not asserted.**

## Claims that need owner or legal verification

1. The ISA eligibility summary in section 5 (recognised stock exchange listing; qualifying funds) was taken from the GOV.UK guidance via a search summary, not from a full page read.
2. Section 6's statements about KID requirements and US-domiciled ETFs reflect widely stated market practice, not a quoted rule.
3. Section 9's 6-month cadence is a platform policy choice, not a regulatory requirement.
4. The five-item checklist wording (`CHECKLIST_ITEMS`) is operational, not a legal test.
5. Whether recording an operator "verification" has any regulatory-perimeter implications for a consumer service is a question for counsel.

## Manual mode (no broker integration)

The strategy flow does not need a broker connection. Without one: the user enters confirmed fills by hand (`src/domain/historical-trade.ts`, `tests/historical-trade.test.ts`, `tests/e2e/historical-trade.spec.ts`), prices can be set through audited, expiring manual overrides (`src/domain/manual-override.ts`, `tests/manual-override.test.ts`), and mappings resolve with `broker = null` requests (`tests/instrument-evidence.test.ts` pins this: broker-agnostic mappings resolve; broker-specific mappings fail closed). Manual mode only ever uses mappings that are EXACT and enabled; an unmapped exposure remains `unsupported`, never substituted.
