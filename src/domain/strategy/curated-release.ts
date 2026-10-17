import {curatedRelease,getStrategyPlugin} from "./catalog";
import {isMethodComplete} from "./method-complete";
import {syntheticCatalogueFixtureAllowed} from "./ci-fixture";

export {CANONICAL_9SIG_CONFIG} from "./catalog/9sig";

function normalised(value:unknown):unknown{
  if(Array.isArray(value))return value.map(normalised);
  if(value&&typeof value==="object")
    return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
      .map(([key,part])=>[key,normalised(part)]));
  return value;
}
function sameRuleConfig(a:unknown,b:unknown){return JSON.stringify(normalised(a))===JSON.stringify(normalised(b));}

/**
 * Operators can enable/retire verified code-defined strategies, but cannot change their
 * mathematical rules, weights, frequency, universe or lookback from the database.
 * A genuinely new canonical variant must be added through a reviewed code release.
 * Legacy non-catalogue definitions remain inert and cannot be created through the API.
 */
export {syntheticCatalogueFixtureAllowed};

/** Production boundary: research/DRAFT reference material is not an executable customer release.
 *  Existing immutable versions remain stored but cannot be newly activated from incomplete code.
 *  The predicate is `isMethodComplete` (see method-complete.ts for the documented checklist).
 */
export function assertReleaseMethodComplete(strategyKey:string){
  if(syntheticCatalogueFixtureAllowed()||process.env.NODE_ENV==="test")return;
  if(!isMethodComplete(getStrategyPlugin(strategyKey)))
    throw new Error("STRATEGY_METHOD_NOT_COMPLETE");
}

export function assertCuratedRules(strategyKey:string,engine:string,config:unknown,inputSchema:unknown){
  assertReleaseMethodComplete(strategyKey);
  const plugin=getStrategyPlugin(strategyKey);
  const release=plugin?curatedRelease(plugin):null;
  if(!release||!release.config||!release.engine||release.engine==="RESEARCH_PENDING")
    throw new Error("CURATED_STRATEGY_NOT_VERIFIED");
  // The archived 9%-Nasdaq v1 strategy remains an accepted EXACT frozen release:
  // publishing a distinct v2 profile must not invalidate active v1 customer ledgers.
  // Only the ruleVersion field differs; no arbitrary legacy config is accepted.
  const archivedNasdaqV1=strategyKey==="quarterly-target-nasdaq-3x"&&
    release.config?.ruleVersion==="WEALTHARR_OWNER_2026_V2_SHEET105"&&
    sameRuleConfig(config,{...release.config,ruleVersion:"WEALTHARR_OWNER_2026_V1"});
  if(engine!==release.engine||!(sameRuleConfig(config,release.config)||archivedNasdaqV1)||
    !sameRuleConfig(inputSchema,release.inputSchema??[]))
    throw new Error("CURATED_STRATEGY_RULES_IMMUTABLE");
}
