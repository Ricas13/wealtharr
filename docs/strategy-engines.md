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
on a HOLD, and a HOLD needs drift <= threshold. Order sizing (orders are sized down to whole shares and never
exceed a leg's remaining gap to its target; minimum trade size applies) can leave drift for which no order of a
permitted size exists. Without a closure rule the review would stay open forever (the engine previously returned
`DATA_REQUIRED` "no executable rebalance step"). The convention is deliberately **not** "no trade could ever
reduce drift": for example buying one extra whole share that overshoots a leg's gap can reduce the worst
deviation, and the sizing convention does not propose it.

Rules, all in `src/domain/strategy/execution-residue.ts`, `src/domain/execution.ts` and `src/lib/action-service.ts`:

1. **Sub-unit amounts are converged.** Any amount below 0.005 of the account currency (it rounds to 0.00) is never
   traded. The engine returns a HOLD when the worst leg differs by less than that, ignores sub-unit legs, and
   `planPracticalTrade` refuses an order below it (`BELOW_MINIMUM_TRADE`).
2. **Fallback first.** PR #61's cash-buy fallback runs (each blocked exposure is marked once, bounded attempts),
   and a blocked funding SALE (`BELOW_ONE_SHARE`, `BELOW_MINIMUM_TRADE`, `SELLING_DISABLED`) is marked too so the
   engine tries the next overweight leg. Closure is evaluated only after it is exhausted and the result is still
   `DATA_REQUIRED` because of a practical-trade refusal or the engine's "no executable step" outcome, with data
   status `CURRENT`.
3. **Closure predicate** (money in the account currency; `unit` = 0.005, which assumes a 2-decimal currency).
   Per leg: `deviation = |target - current|`, `excess = deviation - threshold x total`,
   `granularity = fractionalShares ? max(minimumTrade, unit) : max(whole-share value, minimumTrade)`,
   `spendable = max(cash - flatFee, 0)` (the cash buffer is deliberately ignored). The review closes only if:
   a. every leg outside the threshold has `excess <=` the value of one whole share of that leg (inclusive);
   b. every overweight leg (deviation >= unit, inside the threshold or not) has `deviation < granularity`, so no
      sale of a permitted size exists even with a preference such as disabled selling removed;
   c. every underweight leg outside the threshold has `deviation < granularity` or `spendable < granularity`;
   d. (whole shares, selling allowed) selling ONE whole share of an overweight leg and buying whole shares of an
      underweight leg with the cash that frees (minimum trade, buffer and fees respected) does not strictly
      reduce the worst leg deviation.
4. **Everything else stays open** with a clear reason: material drift (a), a permitted order that a preference
   blocks (b/c: disabled selling, a cash buffer that is what stops a purchase), an improving step the sizing
   convention cannot propose (d, fail closed; the proposal names the sale and purchase), a leg without a verified
   current price, and any stale, missing, rejected or foreign-currency price, missing mapping or unclassified
   holding.
5. **The HOLD records the residue** (residual drift per leg, residual cash, and the convention in its
   share-mode wording). Confirming it uses the normal HOLD path (`postActionReviewState`): `lastReviewAt`
   advances and `forceReview` clears, so the next review is scheduled normally.
6. **Alerts.** Near a boundary the proposal can alternate between this HOLD and a closure-related
   `DATA_REQUIRED` as prices move. Both use the review's single `REVIEW` alert key, so a review cycle raises one
   notification that is updated in place (no hysteresis state is stored; the closure decision is recomputed from
   the ledger and verified prices each time). Genuine data problems keep their own `DATA_REQUIRED` alert.
7. **Sizing price for a sale** is the held line of the largest position, as in order sizing; a purchase uses the
   mapped line of the account with the most cash.
