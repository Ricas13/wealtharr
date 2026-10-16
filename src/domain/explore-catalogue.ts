import Decimal from "decimal.js";
import type {StrategyPlugin} from "./strategy/catalog/plugin";
import {getExposure} from "./strategy/exposures";
import {syntheticCatalogueFixtureAllowed} from "./strategy/ci-fixture";
import {assessStrategyMarket,type MarketAssessment,type VerifiedCandidate} from "./strategy/market-eligibility";

/**
 * Pure state machine behind the customer Explore catalogue. It never decides whether a strategy is
 * suitable for anyone; it only reports whether the operator has released it and a complete verified
 * market exists, so the page can show or withhold the Start link. Fail closed: every missing or
 * unexpected input yields a non-available state.
 */
export type ExploreCardState="AVAILABLE"|"COMING_SOON"|"RESEARCH";
export type ExploreStartAction="START"|"PLAN_OPTIONS"|"NONE";

/** Engines a customer can be offered today. Mirrors `assertCustomerPublishableEngine` (incl. its CI-only legacy 9Sig exception). */
const CUSTOMER_PUBLISHABLE_ENGINES:ReadonlySet<string>=new Set(["FIXED_ALLOCATION","QUARTERLY_SIGNAL_TARGET"]);

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
  if(!CUSTOMER_PUBLISHABLE_ENGINES.has(input.engine)&&!(input.engine==="VALUE_TARGET"&&syntheticCatalogueFixtureAllowed()))
    return blocked("RESEARCH","The calculation method is not yet verified for customers.");
  if(!input.definitionEnabled)return blocked("COMING_SOON","Not yet released. Awaiting operator review.");
  if(!input.publishedInWindow)return blocked("COMING_SOON","Awaiting a published, verified version.");
  if(!input.rulesVerified)return blocked("COMING_SOON","Awaiting rules review.");
  if(!input.marketVerified)return blocked("COMING_SOON","Awaiting verified instruments for your region.");
  let startAction:ExploreStartAction="START";
  if(!plan.inPlan||plan.atLimit)startAction="PLAN_OPTIONS";
  return {state:"AVAILABLE",reason:null,startAction};
}

/**
 * Binary customer catalogue: unpublished, unverified and research-only strategies are
 * absent, rather than advertised as partial products. PLAN_OPTIONS remains visible
 * because it is a plan restriction on a genuinely released strategy.
 * Do not use this to determine whether an API may create a strategy; that requires
 * independent server-side authorisation and release checks.
 */
export function onlyAvailableExploreCards<T extends {result:ExploreCardResult}>(cards:readonly T[]):T[]{
  return cards.filter(card=>card.result.state==="AVAILABLE"&&card.result.startAction!=="NONE");
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
  /** Safe exposure that funds a quarterly target strategy, and the starting share of the target exposure (percent). */
  safeExposure:string|null;
  startingTargetPercent:string|null;
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
  const empty:ExploreRulesSummary={allocations:[],targetExposure:null,safeExposure:null,startingTargetPercent:null,reviewFrequency:null,leveraged:false};
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
  const safe=typeof config.safeExposure==="string"?exposureLabel(config.safeExposure):null;
  let startingTargetPercent:string|null=null;
  if(safe&&config.initialTargetRatio!=null){
    try{startingTargetPercent=new Decimal(String(config.initialTargetRatio)).times(100).toDecimalPlaces(2).toFixed();}
    catch{startingTargetPercent=null;}
  }
  return {allocations,targetExposure:target,safeExposure:safe,startingTargetPercent,reviewFrequency:frequency,leveraged};
}

/** The only values the `strategy` query parameter of the add-strategy page may take. */
export function preselectedStrategyKey(raw:unknown,allowedKeys:readonly string[]):string|null{
  const value=Array.isArray(raw)?raw[0]:raw;
  if(typeof value!=="string")return null;
  return allowedKeys.includes(value)?value:null;
}

const OPERATOR_NOTE=/licen[cs]|brand|trade\s?mark|research|pending|verif|draft/i;
const GENERATED_DESCRIPTION:Record<string,string>={
  FIXED_ALLOCATION:"Holds fixed target weights and rebalances them on a set review schedule.",
  VALUE_TARGET:"Follows a target value path and compares your portfolio with it at each review.",
  QUARTERLY_SIGNAL_TARGET:"Steers a growth-target line quarterly, funded from a bond fund, with a purchase throttle and sell-skip protection after a large fall.",
  RESEARCH_PENDING:"The method is still being researched. Not yet available."
};

/**
 * Customer-facing description built only from code-owned copy. It never reads the database
 * description (research rows store internal rules text there) and never uses `profile.rules`, which
 * can name funds. Seed descriptions that read like operator notes fall back to a generic sentence.
 */
export function cardDescription(plugin:StrategyPlugin):string{
  const seed=plugin.seedDefinition?.description?.trim()??"";
  if(seed&&seed!==plugin.profile?.rules&&!OPERATOR_NOTE.test(seed))return seed;
  const engine=plugin.profile?.engine??plugin.codeRelease?.engine??plugin.seedDefinition?.engine??"RESEARCH_PENDING";
  return GENERATED_DESCRIPTION[engine]??GENERATED_DESCRIPTION.RESEARCH_PENDING;
}

/** The only risk line shown on a card besides the leverage disclosure; `profile.risks` are operator notes. */
export const GENERIC_RISK_NOTE="All investing carries risk, including loss of capital.";

/**
 * Wrappers the add-strategy form can start an account with when a strategy does not restrict them.
 * Mirrors the fallback list in `CreateStrategyForm`.
 */
export const STARTABLE_WRAPPERS:readonly string[]=["ISA","SIPP","TAXABLE"];

export type OfferableStrategy={
  engine:string;
  config:Record<string,unknown>;
  /** `strategy_definitions.supported_regions`; empty means unrestricted (as in createStrategy). */
  supportedRegions:readonly string[];
  /** `strategy_definitions.supported_wrappers`; empty means unrestricted (as in createStrategy). */
  supportedWrappers:readonly string[];
};
export type OfferableUserMarket={
  country:string;
  currency:string;
  /** Broker the user has stated; null/absent mirrors the form's blank broker field, which only matches generic mappings. */
  broker?:string|null;
  /**
   * Wrapper the user has already chosen, when a page knows one. When absent the strategy is offered
   * if it is available for at least one wrapper the add-strategy form lets the user pick
   * (the strategy's own supported wrappers, otherwise `STARTABLE_WRAPPERS`).
   */
  wrapper?:string|null;
};
export type OfferableResult={offerable:boolean;wrapper:string|null;assessment:MarketAssessment|null};

/**
 * Pure eligibility predicate shared by Explore, the homepage rail and the add-strategy list. It is
 * exactly the check `createStrategy` applies for the same inputs: region and wrapper restrictions,
 * then `assessStrategyMarket(...).available` (all legs, exact country/wrapper/currency/broker),
 * never the "any market anywhere" `supportedMarkets` list. Fail closed on anything missing.
 */
export function isOfferableForUser(input:{
  strategy:OfferableStrategy;userMarket:OfferableUserMarket;mappings:VerifiedCandidate[];asOf:string;
}):OfferableResult{
  const {strategy,userMarket,mappings,asOf}=input;
  const none:OfferableResult={offerable:false,wrapper:null,assessment:null};
  const country=userMarket.country?.trim();
  if(!country)return none;
  if(strategy.supportedRegions.length&&!strategy.supportedRegions.includes(country))return none;
  const startable=strategy.supportedWrappers.length?strategy.supportedWrappers:STARTABLE_WRAPPERS;
  const chosen=userMarket.wrapper?.trim();
  const wrappers=chosen?startable.filter(wrapper=>wrapper===chosen):startable;
  let last:MarketAssessment|null=null;
  for(const wrapper of wrappers){
    const assessment=assessStrategyMarket(strategy.engine,strategy.config,mappings,
      {country,wrapper,currency:userMarket.currency,broker:userMarket.broker??null},asOf);
    last=assessment;
    if(assessment.available)return {offerable:true,wrapper,assessment};
  }
  return {offerable:false,wrapper:null,assessment:last};
}