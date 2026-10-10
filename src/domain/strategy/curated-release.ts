import {RESEARCH_STRATEGIES} from "./research-catalog";

export const CANONICAL_9SIG_CONFIG={
  targetExposure:"NASDAQ_100_3X_LONG",
  initialTargetRatio:"0.60",targetRate:"0.09",contributionTargetRatio:"0.50",
  maxCashUse:"0.90",tolerance:"0.01",reviewFrequency:"QUARTERLY",
  reviewCutoffLocal:"16:00",businessDayConvention:"PREVIOUS",marketHolidays:[]
} as const;

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
  const profile=RESEARCH_STRATEGIES.find(p=>p.key===strategyKey);
  const expected=strategyKey==="9sig"?CANONICAL_9SIG_CONFIG:profile?.config;
  const expectedEngine=strategyKey==="9sig"?"VALUE_TARGET":profile?.engine;
  if(!expected||!expectedEngine||expectedEngine==="RESEARCH_PENDING")
    throw new Error("CURATED_STRATEGY_NOT_VERIFIED");
  if(engine!==expectedEngine||!sameRuleConfig(config,expected)||
    !sameRuleConfig(inputSchema,profile?.inputSchema??[]))
    throw new Error("CURATED_STRATEGY_RULES_IMMUTABLE");
}
