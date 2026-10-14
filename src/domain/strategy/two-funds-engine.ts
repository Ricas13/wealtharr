import Decimal from "decimal.js";
import {fixedAllocationEngine} from "./fixed-allocation";
import {moderateTwoFundsWeights} from "./two-funds-age";
import type {EngineContext,StrategyEngine,ProposedAction} from "./types";

export const TWO_FUNDS_2050_TDF="G3_TDF_2050";
export const TWO_FUNDS_SCV="G3_US_SMALL_CAP_VALUE";
export const TWO_FUNDS_2050_CONFIG={
  retirementYear:2050,
  targetDateExposure:TWO_FUNDS_2050_TDF,
  smallCapValueExposure:TWO_FUNDS_SCV,
  variant:"MERRIMAN_MODERATE_2050",
  reviewFrequency:"ANNUAL",
  rebalanceThreshold:"0.00"
} as const;

export function twoFundsAllocations(config:Record<string,unknown>,at:Date){
  if(config.variant!=="MERRIMAN_MODERATE_2050"||config.retirementYear!==2050||
    config.targetDateExposure!==TWO_FUNDS_2050_TDF||config.smallCapValueExposure!==TWO_FUNDS_SCV||
    config.reviewFrequency!=="ANNUAL"||config.rebalanceThreshold!=="0.00"||
    !Number.isFinite(at.getTime()))throw new Error("INVALID_TWO_FUNDS_CONFIG");
  const years=Math.max(0,2050-at.getUTCFullYear());
  const weights=moderateTwoFundsWeights(years);
  return [
    {exposure:TWO_FUNDS_2050_TDF,weight:weights.targetDateFund},
    {exposure:TWO_FUNDS_SCV,weight:weights.smallCapValue}
  ] as const;
}
const blocked=(ctx:EngineContext,reason:string):ProposedAction=>({
  actionType:"DATA_REQUIRED",title:"Two Funds portfolio requires review",instruction:reason,
  explanation:[],nextState:ctx.state,confidence:"LOW",dueAt:ctx.now
});
export const twoFundsEngine:StrategyEngine={
  key:"TWO_FUNDS_MODERATE",
  validateConfig(raw){twoFundsAllocations(raw,new Date("2026-01-01T00:00:00Z"));},
  calculate(ctx){
    const allocations=twoFundsAllocations(ctx.config,ctx.now);
    if(ctx.dataHealth.status!=="CURRENT")return blocked(ctx,ctx.dataHealth.message??"Verified current data is required.");
    if(!ctx.reviewDue)return {actionType:"NO_ACTION",title:"Next annual review not due",
      instruction:"Review annually as the retirement horizon shortens.",explanation:[],nextState:ctx.state,
      confidence:"HIGH",dueAt:ctx.nextReviewAt};
    const targets=allocations.map(a=>({...a,w:new Decimal(a.weight)}));
    const allowed=new Set<string>(targets.map(a=>a.exposure));
    if(ctx.exposures.some(p=>!allowed.has(p.economicExposure)&&!p.value.eq(0)))
      return blocked(ctx,"Unclassified holdings must be reconciled.");
    if(ctx.exposures.some(p=>!p.value.isFinite()||p.value.lt(0))||!ctx.cash.isFinite()||ctx.cash.lt(0))
      return blocked(ctx,"Portfolio amounts are invalid.");
    const total=ctx.exposures.reduce((v,p)=>v.plus(p.value),ctx.cash);
    if(total.lte(0))return blocked(ctx,"The portfolio needs reconciled cash or positions.");
    // The core FIXED_ALLOCATION engine handles all interior calendar years and ledger deltas.
    if(targets.every(a=>a.w.gt(0))){
      return fixedAllocationEngine.calculate({...ctx,config:{
        allocations:allocations.map(a=>({...a})),reviewFrequency:"ANNUAL",rebalanceThreshold:"0.00"
      }});
    }
    // Boundary years (one target weight reaches exactly zero): trade without creating fictitious tiny exposure.
    const zero=targets.find(a=>a.w.isZero())!;
    const positive=targets.find(a=>a.w.eq(1))!;
    const zeroHeld=ctx.exposures.filter(p=>p.economicExposure===zero.exposure)
      .reduce((v,p)=>v.plus(p.value),new Decimal(0));
    if(zeroHeld.gte("0.01")){
      return {actionType:"SELL",title:"Exit "+zero.exposure,
        instruction:"Sell the remaining "+zero.exposure+" position, record the actual fill, then recalculate.",
        amount:zeroHeld,economicExposure:zero.exposure,currency:ctx.baseCurrency,
        explanation:[{label:"Target weight",value:"0%"}],nextState:ctx.state,
        confidence:"HIGH",dueAt:ctx.now,completesReview:false};
    }
    if(ctx.cash.gte("0.01"))
      return {actionType:"BUY",title:"Allocate to "+positive.exposure,
        instruction:"Invest available strategy cash in "+positive.exposure+" and record the fill.",
        amount:ctx.cash,economicExposure:positive.exposure,currency:ctx.baseCurrency,
        explanation:[{label:"Target weight",value:"100%"}],nextState:ctx.state,
        confidence:"HIGH",dueAt:ctx.now,completesReview:false};
    return {actionType:"HOLD",title:"Allocation on target",
      instruction:"The retirement-year glide path is satisfied.",explanation:[],
      nextState:ctx.state,confidence:"HIGH",dueAt:ctx.now,completesReview:true};
  }
};
