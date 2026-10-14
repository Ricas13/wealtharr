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
gaps; whole shares, a minimum trade, a cash buffer, a fee or a selling preference then make part of that gap
untradable. Code: `src/domain/strategy/execution-residue.ts` (`sizeNextTrade`), `src/domain/execution.ts`,
`src/lib/action-service.ts`.

**Unit.** Whole shares: the validated price of one share of the leg. Fractional: `max(0.005, 10 x flat fee)`
(a trade worth less than ten fees is not made). The minimum trade size and the cash buffer are *preferences*, not
part of the unit. `0.005` assumes a 2-decimal currency.

**At target.** A leg is at target when `|deviation| <= threshold x total`, or `|deviation| <= unit / 2 +
(number of legs) x flat fee`. If every leg is at target the review closes with a HOLD whose explanation lists the
residual deviation per leg and the residual cash. A HOLD is emitted only this way.

**Sizing (one trade per recalculation).** Every leg outside its band is traded to the nearest unit (ties round
down, at least one unit):
1. Sales first, largest deviation first, only if selling is allowed, at most what the *execution account* holds,
   not below the minimum trade.
2. Then purchases, largest deviation first, limited by the *execution account's* spendable cash
   (`cash - buffer - fee`): the nearest count if affordable, else the largest affordable whole count.

**Termination.** An overweight leg is only sold and an underweight leg only bought; a trade to the nearest unit
leaves the leg within `unit / 2` of target (inside its band, which also absorbs the fee-driven drift of targets),
so it is not traded again and a buy-then-sell of the same leg cannot occur. Cash-capped purchases only repeat as
purchases.

**When no permitted trade exists** but a leg is not at target, the review stays `DATA_REQUIRED`, in this order:
an unpriced leg; a preference that blocks (selling disabled / cash buffer / minimum trade size, each alone then
together, evaluated on the execution account); a portfolio too small (a whole-share leg whose unit exceeds its
target, or a leg below 50% of its target) with the minimum investable amount; nothing to sell; a structural cash
shortfall (cash needed shown).

**One-unit exception (whole shares only).** With a threshold of 0, nearest-unit purchases can leave the last leg
less than one unit short while the cash cannot buy one unit. The review then closes with a HOLD ("WITHIN_ONE_UNIT":
"Every holding is within one trading unit of its target. Your cash is less than the cost of one more unit of X; add
about Z to buy it, or keep this allocation") only when ALL hold: every price is validated; no preference (selling,
cash buffer, minimum trade, alone or together) would enable a trade; the portfolio is not too small; no overweight
leg is outside its band; every underweight leg is less than one unit (its price) short; no unit of any underweight
leg is affordable from the execution account's spendable cash; and no one-unit sale of an overweight leg would fund
one. If such a sale would (and does not push that leg more than half a unit below target) it is proposed instead of
closing; otherwise the review stays `DATA_REQUIRED` with the cash needed. Fractional mode never uses it.

Decision order for a review the engine says has to trade: (1) unpriced leg; (2) every leg within threshold, HOLD;
(3) a whole-share leg whose unit exceeds its target, TOO_SMALL; (4) every leg within threshold or half a unit,
HOLD; (5) a permitted nearest-unit trade; (6) blocking preference named; (7) a leg below 50% of target, TOO_SMALL;
(8) the one-unit exception (HOLD, or the funding sale); (9) cash needed / nothing to sell.

**Alerts.** A HOLD / BUY / SELL is a `REVIEW` alert; every `DATA_REQUIRED` is a `DATA_REQUIRED` alert whose title
and instruction carry the specific reason. A change of class is a new `review_key` and therefore a new
notification; a change of message within a class updates the existing notification (and resets it to unread).

**Pricing.** A sale is priced on the held line of the largest position (as in order sizing); a purchase on the mapped
line of the account with the most cash; both must be validated, current and in the account currency.
