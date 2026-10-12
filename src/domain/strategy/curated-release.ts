import {curatedRelease,getStrategyPlugin} from "./catalog";

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
export function assertCuratedRules(strategyKey:string,engine:string,config:unknown,inputSchema:unknown){
  const plugin=getStrategyPlugin(strategyKey);
  const release=plugin?curatedRelease(plugin):null;
  if(!release||!release.config||!release.engine||release.engine==="RESEARCH_PENDING")
    throw new Error("CURATED_STRATEGY_NOT_VERIFIED");
  if(engine!==release.engine||!sameRuleConfig(config,release.config)||
    !sameRuleConfig(inputSchema,release.inputSchema??[]))
    throw new Error("CURATED_STRATEGY_RULES_IMMUTABLE");
}
