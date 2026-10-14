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


## Public-author evidence confirmed October 2026
Jason Kelly explicitly describes 6Sig as a **2x mid-cap stock fund plus general bond fund** in his 2018 strategy comments, and in a 2016 response identifies its **50/50 target reset allocation** (contrasting with historical 3Sig's 80/20). See https://jasonkelly.com/resources/strategies/ . These are author statements, not Reddit guesses. **Do not** infer that 50/50 is a quarterly weight floor or an unconditional rebalance: his 9Sig explanation confirms dynamic weight drift below the reset base. Exact 6Sig reset thresholds, protection counts, opening version and money-management rules remain to be confirmed by an authoritative guide.

Public r/KellyLetter testimony in March 2026 describes 3Sig/6Sig/9Sig as the same core growth-target signal structure with differing leverage and special exceptions: https://www.reddit.com/r/KellyLetter/comments/1s7t5ve/starting_9sig/ . This is useful corroboration, not a licence to import 9Sig's exceptions into 6Sig.
