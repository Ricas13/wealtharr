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
- `specCard` and `goldenTests`: repo paths of the signed-off specification card and of the golden tests, or `null` while they do not exist yet.

Steps to add a strategy:
1. Create `src/domain/strategy/catalog/<key>.ts` with the profile. Use an engine that already exists (`FIXED_ALLOCATION`, `VALUE_TARGET`); a new calculation family also needs an engine implementation. Mark it `RESEARCH_PENDING` (no `config`) until the rules are verified; never invent a rule.
2. Register it in `catalog/index.ts` (import and add to `STRATEGY_PLUGINS`; the order is the display and seed order).
3. Write the spec card `docs/strategy-specs/<name>.md` from the primary source, separating source-derived weights from Wealtharr's review convention.
4. Write golden tests with independently computed expected values (hand-worked, not produced by the code under test) and set `goldenTests` and `specCard` on the plugin.
5. Add the pinned expectations for the new strategy to `tests/strategy-plugin-snapshot.test.ts`, then run `npm run verify`.
6. Release through Admin > Strategy Studio: create the DRAFT version, `ATTEST` (spec card path and golden tests), then `PUBLISH`, then `ENABLE`. Each gate is separate; publishing does not enable, and nothing is enabled automatically.

Changing an existing strategy:
- Published versions are immutable (database trigger, migration 0014). Corrections are new versions, never in-place edits.
- `assertCuratedRules` compares every stored version of a key with the single rule set in its plugin, so editing a plugin's `config` in place makes installed versions read "Stored rules need code review". A genuinely different rule set (for example a regional variant) is added as its own plugin with its own key and its own spec card and golden tests, as described in `docs/strategy-specs/README.md`.
- Metadata-only changes (sources, risks, spec-card or golden-test paths, descriptions) do not alter rules and can be edited in the plugin file directly. The seed does not rewrite installed definitions (except the guarded research-only realignment above), so seed-definition edits generally only affect fresh installs.

## Execution-residue closure (fixed-allocation engine)

This is a Wealtharr **implementation convention**, not a strategy rule. A fixed-allocation review closes only
on a HOLD, and a HOLD needs drift <= threshold. With whole shares, a minimum trade size or a cash buffer, a few
pounds of drift can remain that no practical order removes. Without a closure rule the review would stay open
forever (the engine previously returned `DATA_REQUIRED` "no executable rebalance step").

Rules, all in `src/domain/strategy/execution-residue.ts`, `src/domain/execution.ts` and `src/lib/action-service.ts`:

1. **Sub-unit amounts are converged.** Any amount below 0.005 of the account currency (it rounds to 0.00) is never
   traded. The engine returns a HOLD when the worst leg differs by less than that, ignores sub-unit legs, and
   `planPracticalTrade` refuses an order below it (`BELOW_MINIMUM_TRADE`).
2. **Fallback first.** PR #61's cash-buy fallback runs unchanged (each blocked exposure is marked once, bounded
   attempts). Closure is evaluated only after it is exhausted and the result is still `DATA_REQUIRED` because of
   `BELOW_ONE_SHARE`, `BELOW_MINIMUM_TRADE`, `INSUFFICIENT_SPENDABLE_CASH`, `SELLING_DISABLED` or the engine's
   "no executable step" outcome, with data status `CURRENT`.
3. **Closure predicate.** For every leg `deviation = |target - current|` and
   `excess = deviation - threshold x total`. A leg is closable when `deviation < 0.005`, or `excess <= 0`, or
   `excess <=` the value of **one whole share** of that leg (its verified sizing price). The review closes only if
   every leg is closable (the boundary is inclusive).
4. **Material drift stays open.** If any leg has `excess >` one whole share, the proposal stays `DATA_REQUIRED` and
   says which leg is beyond the threshold by more than a share. A leg outside the threshold without a verified
   current whole-share price also stays `DATA_REQUIRED` (fail closed). Stale, missing, rejected or foreign-currency
   prices, missing mappings and unclassified holdings are never closed.
5. **The HOLD records the residue** (residual drift per leg, residual cash, why no order is practical).
   Confirming it uses the normal HOLD path (`postActionReviewState`): `lastReviewAt` advances and `forceReview`
   clears, so the next review is scheduled normally.
