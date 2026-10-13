# Instrument verification checklist (operator template)

Copy this per candidate. Procedure and definitions: [uk-instrument-selection-methodology.md](uk-instrument-selection-methodology.md). Do not tick an item you did not personally check against a document. Never paste a value you could not source.

Candidate mapping id: ____________   Exposure: ____________   Country / wrapper: GB / ISA   Broker (or none): ____________
Operator: ____________   Date: ____________

## A. Specification (before looking at products)
- [ ] Index family, variant and provider written down from the strategy source
- [ ] Region / maturity band / leverage / direction written down
- [ ] Currency GBP; hedge policy stated by the source (or "source silent, not assumed")

## B. Documents (record URL, date, SHA-256 of the file you retrieved)
- [ ] KID URL (https): ____________  retrieved ____-__-__  SHA-256 ____________________
- [ ] or factsheet URL (https): ____________  retrieved ____-__-__  SHA-256 ____________________
- [ ] Document is for this exact share class and ISIN

## C. Listing
- [ ] Exchange ____  Ticker ____  Currency GBP  (equal to the stored trading line)
- [ ] ISIN ____________ (format and check digit pass; matches the document)
- [ ] SEDOL (optional) ____

## D. ISA eligibility
- [ ] Basis: recognised stock exchange listing / UCITS or authorised fund / other (explain)
- [ ] Source URL (https): ____________  checked ____-__-__
- [ ] Account provider's own rules also allow it (provider page: ____________)

## E. UK retail availability
- [ ] Product has a KID that UK retail investors may receive
- [ ] Not a US-domiciled ETF (or documentary evidence recorded why it is available)

## F. Broker (required when the mapping names a broker)
- [ ] Broker named exactly as on the mapping: ____________
- [ ] Snapshot source: ____________  captured ____-__-__
- [ ] Fractional shares: supported / not supported / not shown

## G. Descriptors (record when the document states them)
- [ ] Hedged: yes / no   Distribution: accumulating / distributing   Domicile: __
- [ ] Replication: physical full / physical sampled / synthetic   TER (fraction): ______

## H. Tie-break (only if several candidates qualified)
- [ ] Ranked by: TER, then domicile code, then accumulating, then fund size, then ISIN
- [ ] Deciding rule and the rejected candidates written in the note

## I. Verification note (at least 20 characters; which documents you read)
______________________________________________________________

## J. Not claimed by this verification
- Purchasability at any broker beyond the dated snapshot; tax treatment; suitability; independent checking of the documents by the platform.

Re-verify by: ____-__-__ (at most 6 months, or earlier on any KID, index, fund or broker-list change).
