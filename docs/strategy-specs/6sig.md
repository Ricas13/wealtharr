# 6Sig: primary-source methodology record

Status: **INCOMPLETE — RESEARCH ONLY, NOT ACTIVATABLE**. Reviewed public statements on 2026-10-14. Not a reproduction of the current paid subscriber guide.

## Definition
Jason Kelly's 6Sig is part of The Kelly Letter Sig family. Published evidence describes a 6% quarterly signal-line growth objective, not a guarantee of portfolio growth. Instrument description: 2x S&P MidCap 400 exposure (MVV in Kelly's 2023 article).

Primary sources: https://jasonkelly.com/2023/03/what-to-buy-in-the-banking-bust/; https://jasonkelly.com/ ; https://jasonkelly.com/2017/01/how-my-signal-system-works/. Kelly identifies his subscriber-only guide and calculator as the sources for full implementation instructions.

## Rebalancing rule
Publicly stated target progression is 6% each quarter. Kelly describes comparing actual stock-fund exposure with the signal line, buying below and selling above, with new cash initially in the defensive sleeve. Public author comments say half the new contributions are added to a growth signal line. The independently checked arithmetic is in src/domain/strategy/sig-research.ts, deliberately NOT in a trading engine. The anchor after incomplete fills, capped buying, protective skips and reset rules remain unresolved.

## Instrument requirements
2x S&P MidCap 400 exposure (MVV in Kelly's 2023 article). Regional substitutes need independent economic-exposure, leverage, currency, market-calendar and wrapper eligibility checks. A nominally similar UCITS instrument is not automatically identical.

## Owner-decision list
- Obtain and record dated, legitimately accessed first-party guide for the selected 6Sig revision, with explicit permission/rights analysis for commercial representation.
- Leverage-management rules and 30 Down sell-skip count must come from the current guide. Do not import 3Sig or 9Sig default weights, skip counts or reset logic.
- Confirm starting and reset allocations, income/distribution accounting, contribution and withdrawal treatment, partial fills, fees, precision and calendar scheduling.
- Verify the regional instrument and reserve sleeve; preserve existing immutable versions and historical fills without silent backfills.
- Until each point is resolved, leave method completeness **INCOMPLETE** and prohibit new activation.

## Golden tests
tests/sig-research.test.ts covers source-confirmed rate and contribution arithmetic only. This is NOT a full golden trading suite. Future author-derived scenarios must include 30 Down, spike/base resets, exhausted reserves, skipped and delayed quarters, price failure and multi-fill accounting.

## Rights and provenance
Factual public statements are attributed and linked. Wealtharr has not established a licence to reproduce paid subscriber-only rulebooks, source text or the author's brand as an endorsed commercial offering. Do not imply endorsement or label a non-equivalent approximation as 6Sig.
