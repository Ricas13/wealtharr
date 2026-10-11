import {assessStrategyMarket,type VerifiedCandidate,type MarketChoice} from "./market-eligibility";

export type LinkedMarketsResult={available:boolean;eligibleAccountIndices:number[];missingExposures:string[];supportedMarkets:string[]};

/**
 * A partial mapping is not an implementation. Require at least one linked
 * brokerage/account wrapper with every code-defined strategy exposure.
 * Combining partial universes across accounts needs its own reviewed release,
 * rather than silently treating two incompatible accounts as a valid market.
 */
export function assessLinkedMarkets(
  engine:string,config:Record<string,unknown>,candidates:VerifiedCandidate[],
  accounts:MarketChoice[],asOf:string
):LinkedMarketsResult{
  if(!accounts.length)return {available:false,eligibleAccountIndices:[],missingExposures:["No eligible investment accounts"],supportedMarkets:[]};
  const checks=accounts.map(choice=>assessStrategyMarket(engine,config,candidates,choice,asOf));
  const eligibleAccountIndices=checks.flatMap((result,index)=>result.available?[index]:[]);
  const available=eligibleAccountIndices.length>0;
  if(available)return {available:true,eligibleAccountIndices,missingExposures:[],supportedMarkets:[...new Set(checks.flatMap(r=>r.supportedMarkets))].sort()};
  const missing=[...new Set(checks.flatMap(r=>r.missingExposures))].sort();
  return {available:false,eligibleAccountIndices,missingExposures:missing,supportedMarkets:[...new Set(checks.flatMap(r=>r.supportedMarkets))].sort()};
}
