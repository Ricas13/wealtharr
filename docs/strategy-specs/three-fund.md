# Three-Fund Portfolio

Status: **DRAFT, NOT SIGNED OFF.** Written without access to the primary source (the build sandbox cannot reach the web). Every item marked `VERIFY` must be checked against the cited source by a person, then the status changed to SIGNED OFF with name and date, before a version of this strategy can be published (see CLAUDE.md).

## Engine
FIXED_ALLOCATION (research catalogue key `three-fund`).

## Target allocation (as currently seeded)
- DOMESTIC_EQUITY 40% (illustrative)
- INTERNATIONAL_EQUITY 40% (illustrative)
- AGGREGATE_BONDS 20% (illustrative)
Weights are USER SETTINGS; there is no canonical split.

## Primary sources to verify against
- Bogleheads wiki, Three-fund portfolio. VERIFY the page describes three asset classes without fixed weights.

## Rebalance rule
VERIFY: user-chosen review frequency and drift band; no canonical rule. Requires user-configurable weights (Phase 1).

## Open questions
- VERIFY each weight and the exposure definition against the source (no tickers; exposures only).
- VERIFY whether the source states a rebalance schedule or only "periodically"; the product must not claim a canonical schedule the source does not give.
- Instrument mapping per jurisdiction (UK first) is separate work and stays UNVERIFIED until the instrument import exists.

## Golden tests required before publication
Independently computed (spreadsheet or hand) expected trades for at least: on-target, drifted equity-heavy, drifted bond-heavy, a new cash deposit, and a withdrawal. Record the workings next to the test.

## Sign-off
Reviewer: ______  Date: ______  Source checked (URL + date retrieved): ______

**Execution convention (Wealtharr implementation, not part of this strategy):** when whole shares, a minimum trade or a cash buffer leave residue that no practical order can remove, the review closes with a HOLD that records the residual drift and cash. See docs/strategy-engines.md, "Execution-residue closure".
