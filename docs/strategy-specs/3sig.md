# 3Sig: primary-source methodology record

Status: **INCOMPLETE — RESEARCH ONLY, NOT ACTIVATABLE**. Reviewed public statements on 2026-10-14. Not a reproduction of the current paid subscriber guide.

## Definition
Jason Kelly's 3Sig is part of The Kelly Letter Sig family. Published evidence describes a 3% quarterly signal-line growth objective, not a guarantee of portfolio growth. Instrument description: Unleveraged S&P SmallCap 600 exposure (IJR in Kelly's public discussion).

Primary sources: https://jasonkelly.com/3sig/; https://jasonkelly.com/ ; https://jasonkelly.com/2017/01/how-my-signal-system-works/. Kelly identifies his subscriber-only guide and calculator as the sources for full implementation instructions.

## Rebalancing rule
Publicly stated target progression is 3% each quarter. Kelly describes comparing actual stock-fund exposure with the signal line, buying below and selling above, with new cash initially in the defensive sleeve. Public author comments say half the new contributions are added to a growth signal line. The independently checked arithmetic is in src/domain/strategy/sig-research.ts, deliberately NOT in a trading engine. The anchor after incomplete fills, capped buying, protective skips and reset rules remain unresolved.

## Instrument requirements
Unleveraged S&P SmallCap 600 exposure (IJR in Kelly's public discussion). Regional substitutes need independent economic-exposure, leverage, currency, market-calendar and wrapper eligibility checks. A nominally similar UCITS instrument is not automatically identical.

## Owner-decision list
- Obtain and record dated, legitimately accessed first-party guide for the selected 3Sig revision, with explicit permission/rights analysis for commercial representation.
- Historical book plan and current Kelly Letter may differ. '30 Down' sell skips, safe-fund selection, buy-budget, post-fill anchor, reset and withdrawal rules require version-specific source verification.
- Confirm starting and reset allocations, income/distribution accounting, contribution and withdrawal treatment, partial fills, fees, precision and calendar scheduling.
- Verify the regional instrument and reserve sleeve; preserve existing immutable versions and historical fills without silent backfills.
- Until each point is resolved, leave method completeness **INCOMPLETE** and prohibit new activation.

## Golden tests
tests/sig-research.test.ts covers source-confirmed rate and contribution arithmetic only. This is NOT a full golden trading suite. Future author-derived scenarios must include 30 Down, spike/base resets, exhausted reserves, skipped and delayed quarters, price failure and multi-fill accounting.

## Rights and provenance
Factual public statements are attributed and linked. Wealtharr has not established a licence to reproduce paid subscriber-only rulebooks, source text or the author's brand as an endorsed commercial offering. Do not imply endorsement or label a non-equivalent approximation as 3Sig.
