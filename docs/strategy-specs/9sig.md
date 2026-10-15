# 9Sig (Jason Kelly, The Kelly Letter)

Status: **DRAFT, NOT SIGNED OFF.** Research compiled 2026-10-12 from public web pages only. 9Sig is a proprietary plan run inside a paid newsletter. The full rulebook (the Kelly Letter User Guide and subscriber calculator) is behind the paywall and was **not** read. Reddit (r/LETFs and others) could not be reached by the research tools: both the search and fetch tools are blocked from reddit.com. No rule below cites a Reddit thread. Quotation marks are kept to short phrases that came back the same way across repeated fetches. Everything else is paraphrased.

Reviewer: PENDING; independent approval: NO.


> **Source-version conflict confirmed (2026-10-14):** In an October 6, 2019 author comment on https://jasonkelly.com/3sig/, Jason Kelly states that the next line is based on the previous quarter's **desired price**, rather than the eventual fill price, while other author examples discuss a partially funded post-order stock balance affecting later lines. These rules can diverge following capped/unfilled buys. This is a *material unresolved historical-versus-current variant distinction*. Do not release a live 9Sig engine until the current Kelly Letter guide unambiguously determines its target anchor and fill-date treatment.

## Engine
VALUE_TARGET (catalogue key `9sig`, `src/domain/strategy/catalog/9sig.ts`). See `docs/9SIG_IMPLEMENTATION_GAP.md` for how the code differs from this card.

## Who / what
- **Author:** Jason Kelly. The base method is the "3% Signal", from his book *The 3% Signal* (publication year not verified here), now usually called 3Sig. 6Sig and 9Sig are leveraged variants that he runs in his paid newsletter, The Kelly Letter. Kelly says the variants work within the same signal framework [S2, S3].
- **Subscription:** The Kelly Letter (kellyletter.com / jasonkelly.substack.com). A search snippet of his LinkedIn profile gave a price of about $200/yr or $20/month. **Unverified**: the page was not fetched. A forum repost of a 2026-09-06 Kelly letter dates 9Sig's announcement to January 2017 [S9] (**single source**).
- **Variants:** 3Sig grows 3% per quarter in an unlevered small-cap fund (IJR in the book). 6Sig grows 6% in a 2x mid-cap fund (MVV). 9Sig grows 9% in a 3x Nasdaq-100 fund (TQQQ) [S2, S3, S4].

## Sources (retrieved 2026-10-12)
- **S1:** Kelly, "Managing Cash Contributions", https://jasonkelly.substack.com/p/managing-cash-contributions. A 9Sig worked example covering the 9% target, new cash going to the bond fund, half of new cash being added to the signal line, and orders placed at quarter end. **Primary.**
- **S2:** Kelly, "How my signal system works" (2017), https://jasonkelly.com/2017/01/how-my-signal-system-works/. Describes the signal line, selling the surplus into the bond fund and buying the shortfall from it at quarter end, and the 3/6/9% variants. **Primary.**
- **S3:** Kelly, "Get Systematic in 2024", https://jasonkelly.substack.com/p/get-systematic-in-2024. The 9Sig stock fund is TQQQ, paired with a general bond fund; the funds never change; trades are sized by the quarterly price change. **Primary.**
- **S4:** Kelly, Strategies page, https://jasonkelly.com/resources/strategies/. Author replies in the comments include:
  - 2017-11-14 and 2018-01-03: the letter uses the AGG, BND or SCHZ bond funds.
  - 2018-01-03, quoting the user guide: the 90% buying-power throttle and the 100%-gain spike reset.
  - 2018-04-18: says many subscribers run "a base reset allocation below 60% stocks". The sentence is ambiguous about what the letter itself runs.

  **Primary (author comments).**
- **S5:** Kelly, 3Sig page, https://jasonkelly.com/3sig/. Author replies in the comments cover:
  - Half of quarterly contributions go into the signal line.
  - The signal line is built from the previous quarter's actual balance. Kelly explains a low line by saying the previous balance was smaller because a buy was only partly funded.
  - Calendar quarters are recommended.
  - If the bond fund cannot cover a buy, the investor buys what they can afford.
  - The book's "30 down, stick around" rule skips four sells and has a two-year limit.
  - Dividends that cannot be redirected are added to the signal line.

  **Primary (author comments)**, mostly about 3Sig.
- **S6:** Kelly, "TQQQ and volatility decay" (2023-02), https://jasonkelly.com/2023/02/tqqq-and-volatility-decay/. Covers 9Sig: there is no 60% floor, the plan resets to 60% TQQQ from time to time, for example after a 30 down period in which it skips two quarterly sells, and when buying power runs out the plan behaves like buy-and-hold. **Primary.**
- **S7:** Kelly, "The 30 Down rule" (2020-04), https://jasonkelly.com/2020/04/the-30-down-rule/. A video page. The visible text asks why the rule went "from four sell skips to one for 6Sig and 9Sig" but does not answer in text. A reader comment describes the trigger as SPY at least 30% below its highest close in the previous two years. **Primary for the question; the trigger detail is a reader's.**
- **S8:** BestFolio, "Kelly 9Sig Revisited", https://bestfolio.app/blog/kelly-signal-danger-v2, and the earlier https://bestfolio.app/blog/kelly-signal-danger. A third-party backtest. It says 60/40 TQQQ/AGG is the canonical base, signals are 3/6/9% compounding, contributions lift the line by half, the 90% throttle applies, and the 30 Down trigger is SPY at or below 70% of its two-year high. Its two posts **disagree with each other** on the skip count (1 vs 2) and on whether a ">30% bonds" reset is Kelly's. **Secondary.**
- **S9:** Tiger Droppings forum thread reposting a 2026-09-06 Kelly letter excerpt, https://www.tigerdroppings.com/rant/money/does-anyone-here-do-the-jason-kelly-investment-strategy/125025949/. Covers the plan's history and its known weakness in a prolonged bear market; users report holding SGOV as the safe fund and trading at quarter end. **Secondary / anecdotal.**
- **S10:** Community simulator, https://9sig.networthcast.com. A configurable tool. It lets the user choose the target anchor (prior holding or prior target), a buy cap of 50–100% of cash, and a crash hold, so it is **not** evidence for any one rule.

## Rules

| # | Rule | Evidence | Status |
|---|------|----------|--------|
| R1 | Two sleeves: a 3x Nasdaq-100 fund (TQQQ) and a general bond fund. | S3, S4 (AGG/BND/SCHZ), S8 (AGG) | **Confirmed** (fund *type*; the specific bond ticker is the owner's choice, see Q1) |
| R2 | The quarterly growth target is 9%, compounding. | S1 (worked example ×1.09), S2 (3/6/9% table), S8 | **Confirmed** |
| R3 | Review once per quarter on calendar quarters. No intra-quarter trades. | S1, S2 (quarter end), S5 (calendar quarters recommended, quarterly signals only) | **Confirmed** (exact day and price, see R13) |
| R4 | Quarterly balance target = previous quarter's **post-order TQQQ balance** × 1.09. | S5 (Kelly: a partly funded buy made the previous balance, and so the line, smaller). S1 is consistent but cannot tell the readings apart: its Q1 sell filled completely, so the post-order balance equalled the signal line. | **Single source** (primary author comment). Community tools disagree: S8 says "never adjusted down"; S10 offers both options (Q9). |
| R5 | Signal line = quarterly balance target + **half** of the quarter's new cash. | S1 (68,670 + 10,700/2 = 74,020), S4, S5, S8 | **Confirmed** |
| R6 | "New cash" means contributions **plus distributions** (dividends and interest). All new cash goes into the bond fund, never directly into TQQQ. | S1 (10,000 + 700 distributions); S4/S5 ("all contributions go to the bond fund") | **Confirmed** (S1 for distributions is single source but primary) |
| R7 | Each quarter starts fresh: leftover new cash from earlier quarters is not carried into the signal. | S1 | **Single source** (primary) |
| R8 | If TQQQ is above the signal line, sell the surplus and buy the bond fund. If it is below, sell bonds and buy the shortfall. No tolerance band is stated: any difference is a trade. | S1, S2, S5 (Kelly confirms a reader's statement that anything under target is a buy) | **Confirmed** (the absence of a band is inferred from worked examples that trade exact amounts; no source states a minimum trade) |
| R9 | Buying-power throttle: no quarterly buy may use more than 90% of the bond fund's balance. | S4 (2018-01-03 author reply quoting the user guide), S8 (third party; may derive from S4) | **Single source** (primary, 2018; may be superseded, same reply as R14) |
| R10 | If the bond fund cannot cover a buy, buy what it can afford. Until buying power returns the plan behaves like buy-and-hold. It does not ask for outside cash. | S5 (partial buy example), S6 | **Confirmed** |
| R11 | Starting and base-reset allocation: 60% TQQQ / 40% bonds. | S6 ("reset back to" 60%), S8 (canonical 60/40). S4 (2018): many subscribers run a base reset below 60% stocks. The wording of the sentence is ambiguous about whether the letter itself runs 60% or below 60%. | **Unverified as current**: 60/40 is common, but the letter's actual base is unclear (Q2) |
| R12 | 30 Down: after a large SPY drawdown, skip upcoming sell signals; buys continue. | Trigger: S7 reader comment and S8 (SPY ≤ 70% of its 8-quarter / 2-year high close). Skip count: S5 (book, 4), S7 (changed to **one** for 6Sig/9Sig), S6 (2023: **two**), S8 (1 or 2). | **Unverified**: Kelly's own pages conflict on the skip count; the trigger is stated only by a reader and a third party (Q3) |
| R13 | Which price: quarter-end close vs the prior Friday's close. | S1/S2 say quarter end; S5 (3Sig comment) says signals use the prior Friday's close and fills follow on Monday | **Unverified / conflicting** (Q4) |
| R14 | Spike reset: if TQQQ gains ≥100% in a quarter AND, after the rebalance, TQQQ is between 60% and 100% of the plan AND the plan is not in a 30 Down no-sell period, reset TQQQ to 60%. | S4 (2018 author reply quoting the user guide), S8 | **Single source** (primary but from 2018; may be superseded; Q5) |
| R15 | Reset to the base allocation when bonds grow too large (">30% bonds"). | S5 (a 3Sig spreadsheet note); S8 contradicts itself on whether this is Kelly's rule | **Unverified** for 9Sig (Q6) |
| R16 | Withdrawals / decumulation. | Not found for 9Sig | **Unverified** (Q7) |
| R17 | No floor on the TQQQ weight: repeated sells may take it below 60%. | S6 | **Single source** (primary) |


## October 2026 forum cross-check (not author-certified)
- March 2026 r/KellyLetter discussion reports TQQQ **quarterly close** 30% below its preceding two-year quarterly-close high as the contemporary 9Sig 30 Down trigger, and **two sell signals** skipped (intervening buys remain executable). https://www.reddit.com/r/KellyLetter/comments/1s8473h/30_down_rule_price_point/ and https://www.reddit.com/r/KellyLetter/comments/1q7e2v9/query_on_30_down_rule/ . This contradicts earlier SPY/one-skip accounts: source version is crucial.
- A separate 2026 thread reports that resets occur after the 30 Down skips and describes a 100% spike. https://www.reddit.com/r/KellyLetter/comments/1s51l8j/30_down_rule/ . Forum posts disagree on exact later reset condition and calendar offset; no unverified reset is activated.
- Public Kelly 2018 primary source explicitly requires spike gain >=100% in one quarter, stock portfolio weight between 60% and 100% **after normal rebalance**, and no 30 Down period: https://jasonkelly.com/resources/strategies/ . The 90% buy-power throttle is likewise author-documented; the current guide revision remains to be verified.
- `src/domain/strategy/9sig-community-rules.ts` and `tests/9sig-community-rules.test.ts` implement these as **research-only** version-labelled, fail-closed predicates. They do not certify the full 2026 plan and do not issue trades.

## Hand-worked examples

All figures in USD. They are worked by hand, not taken from the code. Example A reproduces Kelly's own published numbers. Example B uses invented quarterly returns and assumes **0% return on the bond fund** so the arithmetic is easy to check. It applies R2, R4, R5, R8, R9 and R10 only. The unverified rules R12, R14 and R15 are deliberately not applied and are flagged where they might fire.

### Example A: Kelly's published 9Sig contribution example (S1)
Starting post-order TQQQ balance: 63,000.00.

Q1:
1. Quarterly balance target = 63,000.00 × 1.09 = 68,670.00.
2. New cash = 10,000 contribution + 700 distributions = 10,700.00. Half = 5,350.00.
3. Signal line = 68,670.00 + 5,350.00 = 74,020.00.
4. TQQQ balance at quarter end = 84,020.00, which is above the line. **Sell 10,000.00** of TQQQ and buy bonds.
5. Post-order TQQQ balance = 74,020.00.

Q2:
1. Quarterly balance target = 74,020.00 × 1.09 = 80,681.80. S1 shows this rounded to 80,682.
2. New cash = 12,000 + 800 = 12,800.00. Half = 6,400.00.
3. Signal line = 80,681.80 + 6,400.00 = 87,081.80 (S1: 87,082).
4. TQQQ balance at quarter end = 67,358.00, which is below the line. Shortfall = 87,081.80 − 67,358.00 = **buy 19,723.80** (S1: 19,724). S1 does not give the bond balance, so the 90% throttle cannot be checked here.

### Example B: 60/40 start, no contributions, the throttle binds

Q0 (start): plan 10,000.00. TQQQ 6,000.00 (60%), bonds 4,000.00.

Q1: TQQQ returns +20%.
1. TQQQ = 6,000.00 × 1.20 = 7,200.00.
2. Signal = 6,000.00 × 1.09 = 6,540.00.
3. Surplus = 660.00. **Sell 660.00.**
4. After the trade: TQQQ 6,540.00, bonds 4,660.00.

Q2: TQQQ returns −30%.
1. TQQQ = 6,540.00 × 0.70 = 4,578.00.
2. Signal = 6,540.00 × 1.09 = 7,128.60.
3. Shortfall = 2,550.60.
4. Throttle cap = 0.90 × 4,660.00 = 4,194.00. The shortfall is under the cap. **Buy 2,550.60.**
5. After the trade: TQQQ 7,128.60, bonds 2,109.40.

Q3: TQQQ returns −50%.
1. TQQQ = 7,128.60 × 0.50 = 3,564.30.
2. Signal = 7,128.60 × 1.09 = 7,770.174 (7,770.17).
3. Shortfall = 4,205.87.
4. Throttle cap = 0.90 × 2,109.40 = 1,898.46. **Buy 1,898.46** (capped, R9/R10).
5. After the trade: TQQQ 5,462.76, bonds 210.94. This is the only buy this quarter.

Q4: TQQQ returns +10%.
1. TQQQ = 5,462.76 × 1.10 = 6,009.036 (6,009.04).
2. Signal (R4, anchored on the **actual** post-order balance) = 5,462.76 × 1.09 = 5,954.4084 (5,954.41).
3. Surplus = 6,009.04 − 5,954.41 = **sell 54.63**.
4. Caveat: a TQQQ fall of this size may coincide with a 30 Down trigger on SPY (R12). That rule would skip this sell. The trigger depends on SPY data and on an unverified skip count, so it is not applied here.
5. For contrast, if the line were anchored on the previous **target** (the community "never adjusted down" reading), Q4 signal = 7,770.17 × 1.09 = 8,469.49. The plan would then call for a **buy** of 2,460.45, capped at 0.9 × 210.94 = 189.85. The two readings point in **opposite directions** in this quarter.

Spike reset check (R14), illustrative: suppose instead that Q1 had returned +100%. Then:
1. TQQQ = 12,000.00, signal = 6,540.00, so sell 5,460.00.
2. After the trade: TQQQ 6,540.00 and bonds 9,460.00, so TQQQ is 40.9% of 16,000.00.
3. That is outside the rule's 60–100% band, so no spike reset would apply.

## Open questions only the owner (a subscriber) can resolve
- **Q1:** Which bond fund does the current Kelly Letter 9Sig use: AGG, BND, SCHZ, or a T-bill fund such as SGOV? Is a money-market or cash balance an accepted substitute? This matters for UK/ISA mapping.
- **Q2:** What is the current starting and base-reset allocation? 60/40, or a base below 60% (S4's wording is ambiguous)? What exact percentage?
- **Q2b:** Is the 90% buying-power throttle (R9) still in the current user guide? Is it measured against the bond balance at the start of the quarter?
- **Q3:** What is the current 30 Down rule, exactly?
  - Trigger: SPY or QQQ; ≤70% of the highest *quarterly* close over the last 8 quarters?
  - Number of sells skipped for 9Sig: 1, 2 or 4?
  - When does the period end?
  - Does a reset to the base allocation follow?
- **Q4:** Which price does the signal use? The last trading day's close, or the prior Friday's close with fills on the next trading day? Which time zone and exchange calendar?
- **Q5:** Is the 100% spike reset (S4, 2018) still in the current user guide? Is its "60%–100%" condition measured as TQQQ's share of the plan after the rebalance?
- **Q6:** Is there any reset or skim when the bond sleeve grows large (">30% bonds"), or is that a 3Sig-only spreadsheet convention?
- **Q7:** How are withdrawals handled? Is half of a withdrawal subtracted from the signal line, as the mirror image of R5?
- **Q8:** Does the user guide state a minimum trade size or tolerance? If not, the plan trades any non-zero difference (R8).
- **Q9:** Confirm that R4 applies in the guide: the signal line is anchored on the actual post-order TQQQ balance, so an under-funded buy lowers the next line.
- **Q10:** Licensing: may Wealtharr implement and name a proprietary paid strategy at all?

## Golden tests required before publication
Use independently computed expected values for Example A Q1–Q2 and Example B Q1–Q4. Add one case for each rule once the owner confirms it: R12 (30 Down skip), R14 (spike reset), a distribution counted as new cash, and a withdrawal. Record the workings next to the test.

## Sign-off
Reviewer: ______  Date: ______  Source checked (URL + date retrieved): ______


## Material live dispute found 2026-10-14 — defensive price benchmark
- March 30 2026 r/KellyLetter participants explicitly quote a **TQQQ** quarterly closing trigger (April 2 2026 TQQQ threshold $36.90, next two sells skipped): https://www.reddit.com/r/KellyLetter/comments/1s8473h/30_down_rule_price_point/ . The price is a dated signal, **not** a reusable live threshold.
- Jason Kelly's **2020** primary article describes the *SPY* 8-quarter-close reference and says that 6Sig/9Sig then skipped **one** sell, not four: https://jasonkelly.com/2020/04/the-30-down-rule/ . Jason's **2023** primary article confirms 9Sig by then skipped **two** sell signals and reset to 60/40 afterward: https://jasonkelly.com/2023/02/tqqq-and-volatility-decay/ . Neither establishes the benchmark underlying **2026** subscriber calculations by itself.
- BestFolio's independently published **Oct 13 2026** methodology update *claims* 6Sig/9Sig use **SPY**, and acknowledges that its model used the plan ETF previously: https://bestfolio.app/changelog . This directly conflicts with community reports about 2026 subscriber TQQQ-trigger prices. A third-party platform is not authoritative for Jason Kelly. Version/date/source evidence must resolve this before activation.
- Jan 2026 r/KellyLetter commenters describe base reset to 60/40 **after two skipped sells, at the next qualifying sell**, with buys between skips not resetting the count: https://www.reddit.com/r/KellyLetter/comments/1q7e2v9/query_on_30_down_rule/ . This is stronger than a blanket rule to reset immediately when protection expires but is still community testimony.
- Forum participants note Kelly Letter quarter boundaries need not equal calendar quarter ends; June 26 2026 is identified as a subscriber Q2 close, not June 30: https://www.reddit.com/r/KellyLetter/comments/1vh8b1z/9sig_and_done/ . A normal calendar-quarter scheduler is **not** a verified replacement for the letter's trading schedule.

## 2026-10-15 correction: third-party backtest rules are NOT Kelly's original
BestFolio explicitly acknowledges that (1) the portfolio-level **10% bond floor**, (2) the **automatic reset when bonds exceed 30% after sells**, and (3) its choice to **never adjust the target line down** were third-party model conventions, not author-verified current 9Sig rules: https://bestfolio.app/blog/kelly-signal-danger . In https://www.reddit.com/r/KellyLetter/comments/1nz1xjk/questions_about_9sig/ an October 2025 subscriber says there is no routine bond percentage threshold and the mix may drift far from 60/40. Do not implement a generic >30% bond trigger as a Kelly 9Sig rule. The original author primary source (January 2018) does verify a 90% bond buy throttle and **conditional** 100%-gain spike reset, https://jasonkelly.com/resources/strategies/ . The exact timing and equity-bond accounting still require versioned integration.

## Wealtharr owner-defined variant — decisions 2026-10-15 (supersedes earlier alternatives)
**This variant is a Wealtharr-customized implementation, not a certified reproduction of current Kelly Letter rules.** The owner explicitly selects:
1. 30 Down benchmark: **USD TQQQ quarterly closing price**, not SPY. Two skipped sell signals (historical/community evidence). The 30% trigger uses preceding eight quarterly closes.
2. Underfunded quarter anchor: **ACTUAL confirmed post-fill stock value × 1.09** next review, **not** previous desired target. This is the owner's recollection of Kelly's methodology, *not independently re-verified*. Keep the in-progress review's signal target frozen until confirmed fills finish and the review is closed; then anchor the next review to actual holdings.
3. **Last trading day of each calendar quarter**, rather than newsletter dates. Use a verified exchange trading calendar and exact authenticated price history, refusing stale/incomplete data. Optional Kelly Letter date override can be introduced later as a separate version; do not silently switch schedule after a strategy has started.
4. 3Sig and 6Sig may use clearly labelled Wealtharr custom assumptions based on public sources. Do not claim source-certified proprietary methods.
5. Income Sig will be a configurable Wealtharr model; do not advertise undocumented inner weights as Jason Kelly originals.
Existing PUBLISHED 9Sig versions remain immutable. The research engine `NINE_SIG_COMMUNITY` was replaced by the customer-publishable engine `QUARTERLY_SIGNAL_TARGET` (2026-10-15), which implements two-sleeve (risk exposure + bond fund) order sequencing, the NYSE act window, 30 Down, the throttle and the spike reset. It is released as neutral Wealtharr models (`quarterly-target-nasdaq-3x`, `quarterly-target-midcap-2x`, `quarterly-target-smallcap`; cards in this folder), not as the author's 9Sig. The legacy `9sig` plugin below stays unreleased and is kept only so existing ledgers and the CI fixture keep working.
