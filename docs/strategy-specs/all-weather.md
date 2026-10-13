# All Weather (unlevered reference)

Status: **DRAFT, NOT SIGNED OFF.** Written without access to the primary source (the build sandbox cannot reach the web). Every item marked `VERIFY` must be checked against the cited source by a person, then the status changed to SIGNED OFF with name and date, before a version of this strategy can be published (see CLAUDE.md).

## Engine
FIXED_ALLOCATION (research catalogue key `all-weather`).

## Target allocation (as currently seeded)
- BROAD_EQUITY 30%
- LONG_TREASURY 40%
- INTERMEDIATE_TREASURY 15%
- GOLD 7.5%
- BROAD_COMMODITIES 7.5%

## Primary sources to verify against
- Commonly circulated 30/40/15/7.5/7.5 split (Tony Robbins, Money: Master the Game, 2014; Portfolio Charts 'All Seasons'). VERIFY. Bridgewater's actual All Weather is a levered risk-parity fund and is not this strategy; the product must say so.

## Rebalance rule
VERIFY: seeded annual review, 0% threshold. VERIFY any rebalance guidance in the source.

## Open questions
- VERIFY each weight and the exposure definition against the source (no tickers; exposures only).
- VERIFY whether the source states a rebalance schedule or only "periodically"; the product must not claim a canonical schedule the source does not give.
- Instrument mapping per jurisdiction (UK first) is separate work and stays UNVERIFIED until the instrument import exists.

## Golden tests required before publication
Independently computed (spreadsheet or hand) expected trades for at least: on-target, drifted equity-heavy, drifted bond-heavy, a new cash deposit, and a withdrawal. Record the workings next to the test.

## Sign-off
Reviewer: ______  Date: ______  Source checked (URL + date retrieved): ______

**Execution convention (Wealtharr implementation, not part of this strategy):** when whole shares, a minimum trade or a cash buffer leave residue that no practical order can remove, the review closes with a HOLD that records the residual drift and cash. See docs/strategy-engines.md, "Execution-residue closure".
