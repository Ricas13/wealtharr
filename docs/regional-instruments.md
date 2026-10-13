# Regional instrument resolver

Strategies describe economic exposure, leverage and direction. They do not contain tickers.

Instrument is the stable security-level entity. TradingLine represents a dated exchange / ticker / currency listing. RegionalInstrumentMapping connects an economic exposure to a faithful trading line for a country, wrapper and optional broker.

Mappings have effective dates and a fidelity field. The resolver accepts only EXACT mappings for financial actions. If no faithful implementation is configured, the application reports that the strategy is unsupported for that account instead of silently substituting another exposure.

Production instrument mappings are intentionally not guessed by seed data.

## Evidence and the meaning of "verified"

Promoting a candidate to EXACT is a human decision backed by recorded evidence (`regional_instrument_mappings.evidence`, shape in `src/domain/instrument-evidence.ts`, migration 0055). For GB / ISA the server refuses promotion unless the evidence holds a KID or factsheet (URL, retrieval date, SHA-256), the ISA eligibility basis with source URL and date, GBP listing evidence that equals the stored trading line, and, when the mapping names a broker, a dated broker snapshot. The evidence and its SHA-256 are written to the audit event. "Verified" means operator-verified on that date against those documents for that country, wrapper and broker; it is not a guarantee of purchasability, tax treatment or suitability. Procedure: [uk-instrument-selection-methodology.md](uk-instrument-selection-methodology.md); operator template: [instrument-verification-checklist.md](instrument-verification-checklist.md).

## Mappings with no broker (`broker = NULL`)

A mapping with no broker resolves for any broker and for accounts with no broker integration (manual mode). That behaviour is unchanged and pinned by `tests/instrument-evidence.test.ts`. It is a **limitation**: a broker-null mapping does **not** prove the instrument can be bought at any particular broker. Only a recorded broker snapshot is evidence of that, and only as of its capture date. A mapping that names a broker never resolves for another broker or for a manual-mode account. Rows promoted before migration 0055 have empty evidence (`{}`); they keep working and are not demoted.
