import Decimal from "decimal.js";
import type {StrategyEngine} from "./types";
import {assess2026Community9Sig30Down} from "./9sig-community-rules";
import {verifiedSigQuarterCloses} from "./sig-quarter-closes";

/** Research-only executable signal engine. Never approved for customer order issuance. */
export const nineSigCommunityEngine:StrategyEngine={
  key:"NINE_SIG_COMMUNITY",
  validateConfig(c){
    if(c.ruleVersion!=="COMMUNITY_2026_TQQQ_TWO_SELL_SKIP"||
       c.targetExposure!=="NASDAQ_100_3X_LONG")throw new Error("SIG_UNVERIFIED_VARIANT");
  },
  calculate(ctx){
    this.validateConfig(ctx.config);
    const fail=(reason:string)=>({
      actionType:"DATA_REQUIRED" as const,title:"9Sig history needs reconciliation",
      instruction:reason,explanation:[],nextState:ctx.state,confidence:"LOW" as const,dueAt:ctx.now
    });
    if(ctx.dataHealth.status!=="CURRENT")return fail("Verified current market values are required");
    if(!ctx.reviewDue)return {actionType:"NO_ACTION",title:"Not due",instruction:"Next quarterly review",
      explanation:[],nextState:ctx.state,confidence:"HIGH",dueAt:ctx.nextReviewAt};
    const h=ctx.trustedHistory?.find(s=>s.exposure==="NASDAQ_100_3X_LONG");
    let closes:Decimal[];
    try{
      if(!Array.isArray(ctx.config.referenceCloseDates))throw new Error("MISSING_SCHEDULE");
      closes=verifiedSigQuarterCloses(h,ctx.config.referenceCloseDates.map(String),ctx.baseCurrency);
    }catch{return fail("Exact verified quarterly reference dates and prices are required");}
    const quarter=Number(ctx.state.sigQuarterIndex);
    if(!Number.isInteger(quarter)||quarter<8)return fail("Verified quarter index required");
    const exposure=ctx.exposures.filter(p=>p.economicExposure==="NASDAQ_100_3X_LONG")
      .reduce((a,p)=>a.plus(p.value),new Decimal(0));
    if(ctx.exposures.some(p=>p.economicExposure!=="NASDAQ_100_3X_LONG"&&!p.value.isZero()))
      return fail("Other holdings require classification");
    const anchor=ctx.state.sigConfirmedAnchor;
    if(typeof anchor!=="string")return fail("Confirmed post-fill anchor required");
    const target=new Decimal(anchor).mul("1.09").plus(ctx.contributionsSinceReview.mul("0.5"));
    if(!target.isFinite()||target.lt(0)||ctx.cash.lt(0))return fail("Invalid balances");
    const gap=target.minus(exposure);
    let protection;
    try{
      protection=assess2026Community9Sig30Down({
        quarterIndex:quarter,currentTqqqClose:closes[8],precedingEightTqqqQuarterCloses:closes.slice(0,8),
        signal:gap.isNegative()?"SELL":gap.isZero()?"HOLD":"BUY",
        protection:(ctx.state.sigProtection as {startQuarter:number|null;skippedSellCount:number})??{
          startQuarter:null,skippedSellCount:0}
      });
    }catch{return fail("Current 30 Down state cannot be verified");}
    const nextState={...ctx.state,sigProtection:protection.protection,
      reviewTargetValue:target.toString(),reviewContributionsSnapshot:ctx.contributionsSinceReview.toString()};
    if(protection.effectiveSignal==="HOLD"||gap.abs().lt("0.01"))
      return {actionType:"HOLD",title:"No order",instruction:"Model hold",explanation:[],
        nextState:{...nextState,sigConfirmedAnchor:exposure.toString()},
        confidence:"MEDIUM",dueAt:ctx.now};
    if(gap.isNegative())return {actionType:"SELL",title:"Model sell",instruction:"Model stock reduction",
      amount:gap.neg(),currency:ctx.baseCurrency,economicExposure:"NASDAQ_100_3X_LONG",
      explanation:[],nextState,confidence:"MEDIUM",dueAt:ctx.now};
    const opening=new Decimal(String(ctx.state.sigQuarterReserve??ctx.cash));
    const used=new Decimal(String(ctx.state.sigQuarterBuySpent??0));
    if(!opening.isFinite()||!used.isFinite()||opening.lt(0)||used.lt(0))
      return fail("Invalid quarter budget");
    const allowed=Decimal.min(gap,ctx.cash,Decimal.max(0,opening.mul("0.9").minus(used)));
    if(allowed.lt("0.01"))return {actionType:"HOLD",title:"Buying power exhausted",
      instruction:"Model quarter review finished without buying",explanation:[],
      nextState:{...nextState,sigConfirmedAnchor:exposure.toString()},confidence:"MEDIUM",dueAt:ctx.now};
    return {actionType:"BUY",title:"Model buy",instruction:"Model stock addition",
      amount:allowed,currency:ctx.baseCurrency,economicExposure:"NASDAQ_100_3X_LONG",
      explanation:[],nextState:{...nextState,sigQuarterReserve:opening.toString(),
        sigQuarterBuySpent:used.plus(allowed).toString()},confidence:"MEDIUM",dueAt:ctx.now};
  }
};
