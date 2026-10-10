import Decimal from "decimal.js";
import type { EngineContext, ProposedAction, StrategyEngine } from "./types";

function num(config: Record<string, unknown>, key: string, fallback: string) {
  return new Decimal(String(config[key] ?? fallback));
}
function money(v: Decimal) { return v.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2); }

export const valueTargetEngine: StrategyEngine = {
  key: "VALUE_TARGET",
  validateConfig(config) {
    if (!String(config.targetExposure ?? "").trim()) throw new Error("VALUE_TARGET_REQUIRES_EXPOSURE");
    const bounded = ["initialTargetRatio","contributionTargetRatio","maxCashUse","tolerance"] as const;
    for (const key of bounded) {
      const value = new Decimal(String(config[key] ?? ({initialTargetRatio:"0.60",contributionTargetRatio:"0.50",maxCashUse:"1",tolerance:"0.01"} as const)[key]));
      if (!value.isFinite() || value.lt(0) || value.gt(1)) throw new Error("INVALID_VALUE_TARGET_CONFIG:" + key);
    }
    const rate = new Decimal(String(config.targetRate ?? "0"));
    if (!rate.isFinite() || rate.lte("-1") || rate.gt("10")) throw new Error("INVALID_VALUE_TARGET_CONFIG:targetRate");
    const frequency = String(config.reviewFrequency ?? "QUARTERLY");
    if (!["MONTHLY","QUARTERLY","ANNUAL"].includes(frequency)) throw new Error("INVALID_VALUE_TARGET_CONFIG:reviewFrequency");
    const cutoff = String(config.reviewCutoffLocal ?? "16:00");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) throw new Error("INVALID_VALUE_TARGET_CONFIG:reviewCutoffLocal");
  },
  calculate(ctx: EngineContext): ProposedAction {
    if (ctx.dataHealth.status !== "CURRENT") {
      return { actionType:"DATA_REQUIRED",title:"Data needs attention",instruction:ctx.dataHealth.message ?? "Current source data is not reliable enough to calculate a financial action.",explanation:[{label:"Data status",value:ctx.dataHealth.status,kind:"text"}],nextState:ctx.state,confidence:"LOW",dueAt:ctx.nextReviewAt };
    }
    if (!ctx.reviewDue) {
      return { actionType:"NO_ACTION",title:"Everything is on track",instruction:"No strategy review is due yet.",explanation:ctx.nextReviewAt?[{label:"Next review",value:ctx.nextReviewAt.toISOString(),kind:"text"}]:[],nextState:ctx.state,confidence:"HIGH",dueAt:ctx.nextReviewAt };
    }

    const exposureKey=String(ctx.config.targetExposure ?? "");
    const leverage=String(ctx.config.targetLeverage??"").trim()||undefined;
    const unmanaged=ctx.exposures.filter((x)=>x.economicExposure!==exposureKey&&!x.value.eq(0));
    if(unmanaged.length){
      return {
        actionType:"DATA_REQUIRED",
        title:"A holding needs classification",
        instruction:"This strategy contains a holding outside its managed exposure. Move it out of this strategy or reconcile the account before we calculate a trade.",
        explanation:unmanaged.map((item)=>({label:"Outside strategy",value:item.economicExposure,kind:"text" as const})),
        nextState:ctx.state,
        confidence:"LOW",
        dueAt:ctx.now
      };
    }
    const current=ctx.exposures
      .filter((x)=>x.economicExposure===exposureKey)
      .reduce((sum,x)=>sum.plus(x.value),new Decimal(0));
    const isInitial=ctx.state.targetValue == null;
    const previousTarget=new Decimal(String(ctx.state.targetValue ?? current.toString()));
    // An in-progress review carries the SAME target across multiple confirmed
    // fills. Applying the periodic target-rate at every recalculation compounds it
    // several times within one quarter and can create unnecessary trades.
    const savedReviewTarget=ctx.state.reviewTargetValue;
    const pendingTarget=savedReviewTarget==null?null:new Decimal(String(savedReviewTarget));
    if(pendingTarget&&(!pendingTarget.isFinite()||pendingTarget.lt(0)))
      return {actionType:"DATA_REQUIRED",title:"Saved target needs attention",
        instruction:"The review target is invalid. Reconcile the strategy before trading.",
        explanation:[],nextState:ctx.state,confidence:"LOW",dueAt:ctx.now};
    const recordedContributions=ctx.state.reviewContributionsSnapshot==null
      ?ctx.contributionsSinceReview:new Decimal(String(ctx.state.reviewContributionsSnapshot));
    if(!recordedContributions.isFinite()||recordedContributions.lt(0))
      return {actionType:"DATA_REQUIRED",title:"Saved contributions need attention",
        instruction:"The review contribution ledger needs reconciliation before trading.",
        explanation:[],nextState:ctx.state,confidence:"LOW",dueAt:ctx.now};
    const target=pendingTarget
      ? pendingTarget.plus(ctx.contributionsSinceReview.minus(recordedContributions)
        .mul(num(ctx.config,isInitial?"initialTargetRatio":"contributionTargetRatio",isInitial?"0.60":"0.50")))
      : (isInitial
        ? current.plus(ctx.cash).mul(num(ctx.config,"initialTargetRatio","0.60"))
        : previousTarget.mul(new Decimal(1).plus(num(ctx.config,"targetRate","0")))
            .plus(ctx.contributionsSinceReview.mul(num(ctx.config,"contributionTargetRatio","0"))));
    const gap=target.minus(current);
    const threshold=target.abs().mul(num(ctx.config,"tolerance","0.01"));
    const explanation=[
      {label:"Current strategy value",value:money(current),kind:"money" as const},
      {label:isInitial?"Initial target":"Review target",value:money(target),kind:"money" as const},
      {label:"New contributions",value:money(ctx.contributionsSinceReview),kind:"money" as const},
      {label:"Calculated adjustment",value:money(gap),kind:"money" as const}
    ];
    const nextState={...ctx.state,targetValue:target.toString(),
      reviewContributionsSnapshot:ctx.contributionsSinceReview.toString(),
      lastCalculatedAt:ctx.now.toISOString()};

    if(gap.abs().lte(threshold)) return {actionType:"HOLD",title:"No trade required",instruction:"The current exposure is within the strategy tolerance.",explanation,nextState,confidence:"HIGH",dueAt:ctx.now};
    if(gap.gt(0)){
      const amount=Decimal.min(gap,ctx.cash.mul(num(ctx.config,"maxCashUse","1")));
      if(amount.lte(0)) return {actionType:"DATA_REQUIRED",title:"Contribution or cash is required",instruction:"The strategy calls for more exposure, but there is no available cash recorded.",explanation,nextState:ctx.state,confidence:"HIGH",dueAt:ctx.now};
      return {actionType:"BUY",title:"Buy "+money(amount)+" of the target exposure",instruction:"Under the strategy rules you selected, add "+money(amount)+" "+ctx.baseCurrency+" of "+exposureKey+" exposure.",amount,currency:ctx.baseCurrency,economicExposure:exposureKey,leverage,explanation,nextState,confidence:"HIGH",dueAt:ctx.now};
    }
    const amount=gap.abs();
    return {actionType:"SELL",title:"Sell "+money(amount)+" of the target exposure",instruction:"Under the strategy rules you selected, reduce "+exposureKey+" exposure by "+money(amount)+" "+ctx.baseCurrency+".",amount,currency:ctx.baseCurrency,economicExposure:exposureKey,leverage,explanation,nextState,confidence:"HIGH",dueAt:ctx.now};
  }
};
