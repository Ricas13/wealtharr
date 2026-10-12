import Decimal from "decimal.js";
import type {StrategyPlugin} from "./strategy/catalog/plugin";
import {getExposure} from "./strategy/exposures";

/**
 * Pure state machine behind the customer Explore catalogue. It never decides whether a strategy is
 * suitable for anyone; it only reports whether the operator has released it and a complete verified
 * market exists, so the page can show or withhold the Start link. Fail closed: every missing or
 * unexpected input yields a non-available state.
 */
export type ExploreCardState="AVAILABLE"|"COMING_SOON"|"RESEARCH";
export type ExploreStartAction="START"|"PLAN_OPTIONS"|"NONE";

/** Engines a customer can be offered today. Mirrors `assertCustomerPublishableEngine`. */
const CUSTOMER_PUBLISHABLE_ENGINES:ReadonlySet<string>=new Set(["VALUE_TARGET","FIXED_ALLOCATION"]);

export type ExploreCardInput={
  /** Engine the catalogue declares for the strategy, or null when nothing is declared. */
  engine:string|null;
  /** True when the plugin carries implemented rules (a profile config or a code release). */
  hasRules:boolean;
  /** `strategy_definitions.enabled`; false when no definition row exists. */
  definitionEnabled:boolean;
  /** A PUBLISHED version whose effective window contains today exists. */
  publishedInWindow:boolean;
  /** Stored published rules equal the code-reviewed rules (`assertCuratedRules` passed). */
  rulesVerified:boolean;
  /** A complete exact market exists for the viewer's country (`assessStrategyMarket`). */
  marketVerified:boolean;
};
export type ExplorePlanInput={
  /** The viewer already uses every active strategy their plan allows. */
  atLimit:boolean;
  /** The viewer's plan includes this strategy (true when the plan has no restriction). */
  inPlan:boolean;
};
export type ExploreCardResult={
  state:ExploreCardState;
  /** Short neutral reason for non-available states; null when AVAILABLE. */
  reason:string|null;
  /** What the card may offer. Never START unless state is AVAILABLE. Does not affect `state`. */
  startAction:ExploreStartAction;
};

export function exploreCardState(input:ExploreCardInput,plan:ExplorePlanInput={atLimit:false,inPlan:true}):ExploreCardResult{
  const blocked=(state:ExploreCardState,reason:string):ExploreCardResult=>({state,reason,startAction:"NONE"});
  if(!input.engine||input.engine==="RESEARCH_PENDING"||!input.hasRules)
    return blocked("RESEARCH","Source rules and calculation method are still being researched.");
  if(!CUSTOMER_PUBLISHABLE_ENGINES.has(input.engine))
    return blocked("RESEARCH","The calculation method is not yet verified for customers.");
  if(!input.definitionEnabled)return blocked("COMING_SOON","Not yet released. Awaiting operator review.");
  if(!input.publishedInWindow)return blocked("COMING_SOON","Awaiting a published, verified version.");
  if(!input.rulesVerified)return blocked("COMING_SOON","Awaiting rules review.");
  if(!input.marketVerified)return blocked("COMING_SOON","Awaiting verified instruments for your region.");
  let startAction:ExploreStartAction="START";
  if(!plan.inPlan||plan.atLimit)startAction="PLAN_OPTIONS";
  return {state:"AVAILABLE",reason:null,startAction};
}

export const EXPLORE_STATE_LABEL:Record<ExploreCardState,string>={
  AVAILABLE:"Available",COMING_SOON:"Coming soon",RESEARCH:"In research"
};

export type ExploreAllocationRow={exposure:string;label:string;percent:string};
export type ExploreRulesSummary={
  /** Weights of each economic exposure; empty when the strategy has no fixed weights. */
  allocations:ExploreAllocationRow[];
  /** Single target exposure of a value-target strategy, when it has one. */
  targetExposure:string|null;
  reviewFrequency:string|null;
  /** True when any listed exposure carries daily-reset leverage above 1x. */
  leveraged:boolean;
};

const FREQUENCY_LABEL:Record<string,string>={
  MONTHLY:"monthly",QUARTERLY:"quarterly",SEMIANNUAL:"every six months",ANNUAL:"annually"
};

function exposureLabel(id:string):string|null{
  const exposure=getExposure(id);
  return exposure?exposure.description:null;
}

/**
 * Plain-English summary built only from data already in the plugin: exposure weights, the target
 * exposure and the review frequency. Never tickers (profile `rules` text can name funds, so it is
 * deliberately not used) and never invented numbers. Unknown exposures are dropped, not guessed.
 */
export function summariseRules(plugin:StrategyPlugin):ExploreRulesSummary{
  const config=(plugin.profile?.config??plugin.codeRelease?.config??null) as Record<string,unknown>|null;
  const empty:ExploreRulesSummary={allocations:[],targetExposure:null,reviewFrequency:null,leveraged:false};
  if(!config)return empty;
  const frequency=typeof config.reviewFrequency==="string"&&Object.hasOwn(FREQUENCY_LABEL,config.reviewFrequency)
    ?FREQUENCY_LABEL[config.reviewFrequency]:null;
  const allocations:ExploreAllocationRow[]=[];
  let leveraged=false;
  if(Array.isArray(config.allocations)){
    for(const row of config.allocations){
      const item=row as {exposure?:unknown;weight?:unknown};
      if(typeof item?.exposure!=="string")continue;
      const label=exposureLabel(item.exposure);
      if(!label)continue;
      let percent:string;
      try{percent=new Decimal(String(item.weight)).times(100).toDecimalPlaces(2).toFixed();}
      catch{continue;}
      if((getExposure(item.exposure)?.leverage??1)>1)leveraged=true;
      allocations.push({exposure:item.exposure,label,percent});
    }
  }
  const target=typeof config.targetExposure==="string"?exposureLabel(config.targetExposure):null;
  if(typeof config.targetExposure==="string"&&(getExposure(config.targetExposure)?.leverage??1)>1)leveraged=true;
  return {allocations,targetExposure:target,reviewFrequency:frequency,leveraged};
}

/** The only values the `strategy` query parameter of the add-strategy page may take. */
export function preselectedStrategyKey(raw:unknown,allowedKeys:readonly string[]):string|null{
  const value=Array.isArray(raw)?raw[0]:raw;
  if(typeof value!=="string")return null;
  return allowedKeys.includes(value)?value:null;
}
