# Strategy engine architecture

Strategy engines accept an EngineContext and return a ProposedAction plus an explanation and proposed next state.

Implemented reusable families:
- VALUE_TARGET for signal / target strategies such as a parameterised 3Sig / 6Sig / 9Sig family
- FIXED_ALLOCATION for allocation and threshold-rebalance strategies

Definitions and versions remain data, not hard-coded routes. Proprietary configurations can therefore be disabled or replaced without redesigning the platform.

The seed enables only the value-target launch definition. Other definitions remain disabled until their regional implementations and execution workflows are production-ready.


## Review schedule semantics

Review schedules are evaluated in the configured strategy timezone, falling back to the user's timezone. Strategy versions may define reviewCutoffLocal, businessDayConvention (PREVIOUS or NEXT), and marketHolidays. Weekends are always treated as non-business days. DST conversion is performed at the local cutoff time, so a 16:00 London review remains 16:00 London in both GMT and BST. Exchange-specific holiday lists should be versioned with the strategy or supplied from a licensed calendar source before enabling strategies that depend on exact market-session dates.


## Adding and updating strategies

A strategy definition is the stable product identity and editable metadata. A strategy version is the immutable rules release.

New rule changes follow:

1. create or update the strategy definition
2. create a DRAFT strategy version
3. validate the engine configuration and version-specific onboarding schema
4. update the draft as needed
5. publish the version
6. existing strategy instances remain pinned to their old version until the user explicitly migrates
7. migration records preserve from-version, to-version, state-before and state-after
8. unresolved old-version actions are superseded and the migrated instance is forced through a fresh review

Each strategy version snapshots its engine_key. Changing the definition's default engine therefore cannot silently change an old strategy version.

Strategies that use VALUE_TARGET or FIXED_ALLOCATION can be added primarily through data/configuration. A genuinely new calculation family still requires a new StrategyEngine implementation and reference tests; the surrounding SaaS, billing, onboarding, action, versioning and notification architecture does not need to be rebuilt.

Published versions are immutable. Corrections to published rules are new versions, not in-place edits.

## How to add or change a strategy

Every built-in strategy is a plugin: one file in `src/domain/strategy/catalog/`, named after its key, exporting `plugin` (type `StrategyPlugin` from `catalog/plugin.ts`). The registry in `catalog/index.ts` lists them with explicit imports (no filesystem globbing, so it is bundler safe). `RESEARCH_STRATEGIES`, the admin Strategy Studio list, the seed script and the curated-rules check (`assertCuratedRules`) are all derived from that registry; there is no second list to update.

A plugin carries:
- `profile`: key, name, engine, `config` (the immutable executable rules, expressed in economic exposures, never tickers), optional `disclosure` (required for leveraged exposures) and `inputSchema`, plus `rules`, `research` sources and `risks`.
- `seedDefinition`: what a fresh install inserts (name, family, description, engine, proprietary, enabled default, supported regions and wrappers, initial version lifecycle). The seed is insert-only and never modifies an installed version; the only installed-definition update is the guarded research-only realignment (`realignsResearchOnlyDefinition`, coffeehouse/core-four/swensen, disabled and unpublished rows only).
- `specCard` and `goldenTests`: repo paths of the specification card and of the golden tests, or `null` while they do not exist yet.
- `releaseStatus`: the explicit `"COMPLETE"` declaration read by `isMethodComplete`; absent means incomplete. On a real install the seed inserts only complete plugins, as disabled definitions with a PUBLISHED version.

Steps to add a strategy:
1. Create `src/domain/strategy/catalog/<key>.ts` with the profile. Use an engine that already exists (`FIXED_ALLOCATION`, `VALUE_TARGET`); a new calculation family also needs an engine implementation. Mark it `RESEARCH_PENDING` (no `config`) until the rules are verified; never invent a rule.
2. Register it in `catalog/index.ts` (import and add to `STRATEGY_PLUGINS`; the order is the display and seed order).
3. Write the spec card `docs/strategy-specs/<name>.md` from the primary source, separating source-derived weights from Wealtharr's review convention.
4. Write golden tests with independently computed expected values (hand-worked, not produced by the code under test) and set `goldenTests` and `specCard` on the plugin.
5. Add the pinned expectations for the new strategy to `tests/strategy-plugin-snapshot.test.ts`, then run `npm run verify`.
6. Declare `releaseStatus:"COMPLETE"` on the plugin only when `isMethodComplete` (`src/domain/strategy/method-complete.ts`) is satisfied: PUBLISHED seed version, executable rules, customer-publishable engine, every exposure registered with a full structured descriptor, and a spec card (with the model-definition sections) and a dedicated golden-test file that references the strategy key. `tests/method-complete.test.ts` pins the set of complete strategies.
7. Release through Admin > Strategy Studio: create the DRAFT version (or use the seeded PUBLISHED one on a real install), `PUBLISH`, then `ENABLE`. A manual `ATTEST` is optional audit metadata, not a gate. Each gate is separate; publishing does not enable, and nothing is enabled automatically. Enabling also requires a complete EXACT market for the account type.

Changing an existing strategy:
- Published versions are immutable (database trigger, migration 0014). Corrections are new versions, never in-place edits.
- `assertCuratedRules` compares every stored version of a key with the single rule set in its plugin, so editing a plugin's `config` in place makes installed versions read "Stored rules need code review". A genuinely different rule set (for example a regional variant) is added as its own plugin with its own key and its own spec card and golden tests, as described in `docs/strategy-specs/README.md`.
- Metadata-only changes (sources, risks, spec-card or golden-test paths, descriptions) do not alter rules and can be edited in the plugin file directly. The seed does not rewrite installed definitions (except the guarded research-only realignment above), so seed-definition edits generally only affect fresh installs.

## Execution convention for residual drift (fixed-allocation engine)

This is a Wealtharr **implementation convention** (order sizing), not a strategy rule. The engine proposes exact
gaps; whole shares, a minimum trade, a cash buffer, a fee or a selling preference make part of that gap
untradable. Code: `src/domain/strategy/execution-residue.ts` (`sizeNextTrade`), `src/domain/execution.ts`,
`src/lib/action-service.ts`.

**Unit `u`.** Whole shares: the validated price of one share of the leg. Fractional: `max(0.01, 10 x flat fee)`
(a fee is never burnt on a trade worth less than ten fees). The minimum trade size and the cash buffer are
*preferences*, not part of the unit. `0.005` (the smallest order) assumes a 2-decimal currency.

**At target (band).** `|deviation| <= threshold x total`, or `|deviation| <= u/2 + max(legs x flat fee, 0.1 x u)`
(inclusive). The `0.1 x u` term is hysteresis so a price move between fills cannot turn a just-traded leg into a
trade in the other direction; `legs x fee` absorbs the fee-driven drift of the targets.

**Sizing, one trade per recalculation.** Every leg outside its band is traded to the nearest unit (ties round
down, at least one unit):
1. Sales first, largest deviation first: selling allowed, at most what the *execution account* holds, not below
   the minimum trade.
2. Purchases, largest deviation first, limited by the execution account's spendable cash (`cash - buffer - fee`).
   Whole shares: if the nearest purchases of all underweight legs together cost more than the spendable cash,
   purchases are sized with FLOOR (never rounding up and starving another leg); if that gives no purchase the
   nearest affordable count is used.
3. Funding sale: a held overweight leg (inside its band or not) with at least one unit, whose one-unit sale leaves
   it within its band and frees enough cash, *in the same account as the buyer*, for one unit of an underweight leg
   that is at least one unit short.

**Decision order** (for a review the engine says has to trade):
1. an unpriced leg: `DATA_REQUIRED` (UNPRICED);
2. every leg within the threshold: HOLD;
3. every leg within the threshold or its band: HOLD ("within half a unit");
4. a whole-share leg outside its band whose unit exceeds its target: TOO_SMALL (minimum investable shown);
5. a permitted nearest-unit trade, or funding sale: BUY / SELL;
6. a preference that blocks (selling disabled / cash buffer / minimum trade size, each alone then together,
   evaluated on the execution account, including the funding sale): `DATA_REQUIRED` naming it;
7. whole shares, every underweight leg less than one unit short, no unit affordable and nothing outside its band to
   sell: HOLD ("within one unit"): "Every holding is within one trading unit of its target. Your cash is less than
   the cost of one more unit of X; add about Z to buy it, or keep this allocation";
8. cash needed (CASH_SHORTFALL, with the amount) or nothing to sell (NOTHING_TO_SELL, only when no unit of an
   overweight leg is held).

**Termination.** An overweight leg is only sold and an underweight leg only bought; a trade to the nearest unit
leaves the leg within `u/2`, inside its band, so it is not traded again. A funding sale leaves its leg inside its
band, so it happens at most once. Cash-capped purchases only repeat as purchases. Under fixed prices the trades
are bounded by the number of legs plus the number of cash-capped purchases.

**What a HOLD means.** A HOLD at step 3 or 7 records the residual drift per leg, its size as a percentage of the
portfolio and the cash that would bring every underweight leg to target. Worst-case leg drift is about
`0.6 x u` (whole shares, zero fee), i.e. `0.6 x (unit price / portfolio value)` of the portfolio:

| Strategy shape | Legs | Unit = 1% of portfolio | 5% | 20% |
|---|---|---|---|---|
| 60/40 | 2 | 0.6% per leg | 3% | 12% |
| HFEA 55/45 | 2 | 0.6% | 3% | 12% |
| Permanent Portfolio 4 x 25% | 4 | 0.6% per leg (up to 2.4% summed) | 3% (12%) | 12% (48%) |
| Golden Butterfly 5 legs | 5 | 0.6% per leg (up to 3% summed) | 3% (15%) | 12% (60%) |

A leg whose unit is a large share of the portfolio is the cause; fractional shares remove it. The review then
reads TOO_SMALL once a unit exceeds the leg's whole target.

**Alerts.** HOLD, BUY and SELL are `REVIEW` alerts. A `DATA_REQUIRED` outcome carries its own amount-free title and
text and the outcome code (e.g. `DATA_REQUIRED:CASH_SHORTFALL`, `DATA_REQUIRED:PREFERENCE_BLOCKED:SELLING_DISABLED`)
is part of the notification class used for the `review_key`, so a change of reason is a new notification row (the
fingerprint, which includes the instruction, is a new action row too, so the unique `action_id` is not reused). The
closing HOLD shares the cycle's `REVIEW` key with the cycle's BUY/SELL alerts exactly as before this convention.

**Assumptions.** One currency per strategy. A funding sale is only counted when its proceeds land in the buyer's
account. Prices must be validated, current and in the account currency (the stock-split guard of PR #94 must be
applied to the sizing price by whichever change merges second).
