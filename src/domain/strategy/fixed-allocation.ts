import Decimal from "decimal.js";
import { REVIEW_FREQUENCY_MONTHS } from "../schedule";
import { planRebalance } from "./rebalance-plan";
import type { EngineContext, ProposedAction, StrategyEngine } from "./types";

type Allocation = { exposure: string; weight: string | number; leverage?: string | number };

function money(v: Decimal) {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2);
}

/**
 * Published allocations are immutable. Personal account settings never override a famous
 * strategy's mathematical percentages. Historical custom-weight versions fail closed.
 */
export function effectiveAllocations(config: Record<string, unknown>, settings: Record<string, unknown>): Allocation[] | null {
  if(config.userWeights===true||Object.keys(settings).some(key=>key.startsWith("weight_")))return null;
  return (config.allocations??[]) as Allocation[];
}

export const fixedAllocationEngine: StrategyEngine = {
  key: "FIXED_ALLOCATION",
  validateConfig(config) {
    const allocations = (config.allocations ?? []) as Allocation[];
    if (!Array.isArray(allocations) || allocations.length < 2) throw new Error("FIXED_ALLOCATION_REQUIRES_ALLOCATIONS");
    const seen = new Set<string>();
    let total = new Decimal(0);
    for (const allocation of allocations) {
      const exposure = String(allocation.exposure ?? "").trim();
      const weight = new Decimal(String(allocation.weight ?? ""));
      if (!exposure || seen.has(exposure) || !weight.isFinite() || weight.lte(0) || weight.gt(1)) throw new Error("INVALID_FIXED_ALLOCATION_CONFIG");
      seen.add(exposure);
      total = total.plus(weight);
    }
    if (total.minus(1).abs().gt("0.00000001")) throw new Error("FIXED_ALLOCATION_WEIGHTS_MUST_SUM_TO_ONE");
    const threshold = new Decimal(String(config.rebalanceThreshold ?? "0.05"));
    if (!threshold.isFinite() || threshold.lt(0) || threshold.gt(1)) throw new Error("INVALID_FIXED_ALLOCATION_THRESHOLD");
    if(config.userWeights===true)throw new Error("CUSTOM_WEIGHTS_NOT_SUPPORTED");
    if(config.userWeights!==undefined&&config.userWeights!==false)throw new Error("INVALID_FIXED_ALLOCATION_USER_WEIGHTS");
    const frequency = String(config.reviewFrequency ?? "QUARTERLY");
    if (!Object.hasOwn(REVIEW_FREQUENCY_MONTHS,frequency)) throw new Error("INVALID_FIXED_ALLOCATION_REVIEW_FREQUENCY");
  },
  calculate(ctx: EngineContext): ProposedAction {
    if (ctx.dataHealth.status !== "CURRENT") {
      return {
        actionType: "DATA_REQUIRED",
        title: "Data needs attention",
        instruction: ctx.dataHealth.message ?? "Current source data is not reliable enough to calculate a rebalance.",
        explanation: [{ label: "Data status", value: ctx.dataHealth.status }],
        nextState: ctx.state,
        confidence: "LOW",
        dueAt: ctx.nextReviewAt
      };
    }
    if (!ctx.reviewDue) {
      return {
        actionType: "NO_ACTION",
        title: "Everything is on track",
        instruction: "No allocation review is due yet.",
        explanation: [],
        nextState: ctx.state,
        confidence: "HIGH",
        dueAt: ctx.nextReviewAt
      };
    }

    const allocations = effectiveAllocations(ctx.config, ctx.settings);
    if (!allocations) {
      return {
        actionType: "DATA_REQUIRED",
        title: "Check your target weights",
        instruction: "This saved version contains unsupported custom allocation rules. Reconcile your holdings and migrate to a code-reviewed published strategy release.",
        explanation: [],
        nextState: ctx.state,
        confidence: "LOW",
        dueAt: ctx.now
      };
    }
    const managedExposures=new Set(allocations.map((allocation)=>String(allocation.exposure)));
    const unmanaged=ctx.exposures.filter((position)=>!managedExposures.has(position.economicExposure)&&!position.value.eq(0));
    if(unmanaged.length){
      return {
        actionType:"DATA_REQUIRED",
        title:"A holding needs classification",
        instruction:"This portfolio contains a holding outside the strategy allocation. Move it out of this strategy or reconcile the account before rebalancing.",
        explanation:unmanaged.map((item)=>({label:"Outside strategy",value:item.economicExposure,kind:"text" as const})),
        nextState:ctx.state,
        confidence:"LOW",
        dueAt:ctx.now
      };
    }
    const threshold = new Decimal(String(ctx.config.rebalanceThreshold ?? "0.05"));
    const invested = ctx.exposures.reduce((sum, p) => sum.plus(p.value), new Decimal(0));
    const total = invested.plus(ctx.cash);
    if (total.lte(0) || !allocations.length) {
      return {
        actionType: "DATA_REQUIRED",
        title: "Portfolio data is incomplete",
        instruction: "Add holdings or reconcile the account before calculating a rebalance.",
        explanation: [],
        nextState: ctx.state,
        confidence: "LOW",
        dueAt: ctx.now
      };
    }

    const rows = allocations.map((a) => {
      const current = ctx.exposures.filter((p) => p.economicExposure === a.exposure).reduce((sum,p)=>sum.plus(p.value),new Decimal(0));
      const target = total.mul(new Decimal(String(a.weight)));
      return { exposure: a.exposure, leverage:a.leverage, current, target, delta: target.minus(current) };
    });
    const worst = [...rows].sort((a,b) => b.delta.abs().cmp(a.delta.abs()))[0];
    const drift = worst.delta.abs().div(total);

    const explanation = rows.map((r) => ({
      label: r.exposure,
      value: "current " + money(r.current) + " · target " + money(r.target) + " · delta " + money(r.delta),
      kind: "text" as const
    }));

    if (drift.lte(threshold)) {
      return {
        actionType: "HOLD",
        title: "No rebalance required",
        instruction: "All configured exposures are within the strategy rebalance threshold.",
        explanation,
        nextState: { ...ctx.state, lastCalculatedAt: ctx.now.toISOString() },
        confidence: "HIGH",
        dueAt: ctx.now
      };
    }

    // Show the whole rebalance (sales first, then purchases) so the investor sees where this step leads.
    // Only the first step is proposed; the next one is recalculated from the actual fill.
    const legs=planRebalance({
      rows:allocations.map((a)=>({exposure:a.exposure,current:rows.find((r)=>r.exposure===a.exposure)!.current,weight:new Decimal(String(a.weight))})),
      cash:ctx.cash,threshold
    });
    legs.forEach((leg,index)=>explanation.push({label:"Full plan, step "+(index+1),value:(leg.side==="SELL"?"Sell ":"Buy ")+money(leg.amount)+" "+ctx.baseCurrency+" of "+leg.exposure,kind:"text"}));

    const underweight=[...rows].filter((row)=>row.delta.gt(0)).sort((a,b)=>b.delta.cmp(a.delta))[0];
    if(underweight&&ctx.cash.gt(0)){
      const amount=Decimal.min(underweight.delta,ctx.cash);
      const projected=rows.map((row)=>row.exposure===underweight.exposure?{...row,current:row.current.plus(amount)}:row);
      const projectedWorst=projected.reduce((max,row)=>Decimal.max(max,row.target.minus(row.current).abs().div(total)),new Decimal(0));
      return {
        actionType:"BUY",
        title:"Use available cash on "+underweight.exposure,
        instruction:"Buy "+money(amount)+" "+ctx.baseCurrency+" of "+underweight.exposure+". This moves the portfolio toward its target without an unnecessary sale.",
        amount,
        currency:ctx.baseCurrency,
        economicExposure:underweight.exposure,
        leverage:underweight.leverage==null?undefined:String(underweight.leverage),
        explanation,
        nextState:{...ctx.state,lastCalculatedAt:ctx.now.toISOString()},
        confidence:"HIGH",
        dueAt:ctx.now,
        completesReview:projectedWorst.lte(threshold)
      };
    }

    const overweight=[...rows].filter((row)=>row.delta.lt(0)).sort((a,b)=>a.delta.cmp(b.delta))[0];
    if(overweight){
      const amount=overweight.delta.abs();
      return {
        actionType:"SELL",
        title:"Free cash from "+overweight.exposure,
        instruction:"Sell about "+money(amount)+" "+ctx.baseCurrency+" of "+overweight.exposure+". We will recalculate the next step from the actual fill.",
        amount,
        currency:ctx.baseCurrency,
        economicExposure:overweight.exposure,
        leverage:overweight.leverage==null?undefined:String(overweight.leverage),
        explanation,
        nextState:{...ctx.state,lastCalculatedAt:ctx.now.toISOString()},
        confidence:"HIGH",
        dueAt:ctx.now,
        completesReview:false
      };
    }

    return {
      actionType:"DATA_REQUIRED",
      title:"Rebalance needs attention",
      instruction:"The allocation is outside its threshold but no executable rebalance step could be determined.",
      explanation,
      nextState:ctx.state,
      confidence:"LOW",
      dueAt:ctx.now
    };
  }
};
