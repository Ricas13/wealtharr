import {curatedReleaseForVersion,getStrategyPlugin} from "./catalog";

export {CANONICAL_9SIG_CONFIG,CANONICAL_9SIG_V1_1_CONFIG} from "./catalog/9sig";

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
 *
 * `version` is the stored version string. A later code release (for example 9Sig "1.1") is accepted
 * only for exactly its own version string; without a version only the base release is accepted.
 */
export function assertCuratedRules(strategyKey:string,engine:string,config:unknown,inputSchema:unknown,version?:string|null){
  const plugin=getStrategyPlugin(strategyKey);
  const release=plugin?curatedReleaseForVersion(plugin,version):null;
  if(!release||!release.config||!release.engine||release.engine==="RESEARCH_PENDING")
    throw new Error("CURATED_STRATEGY_NOT_VERIFIED");
  if(engine!==release.engine||!sameRuleConfig(config,release.config)||
    !sameRuleConfig(inputSchema,release.inputSchema??[]))
    throw new Error("CURATED_STRATEGY_RULES_IMMUTABLE");
}
