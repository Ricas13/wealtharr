import Decimal from "decimal.js";

/**
 * A stand-alone immutable buy-budget accumulator for testing quarter-scoped
 * value-target controls. This does not infer which Sig variant, source date
 * or reset policy makes the budget appropriate for live trades.
 */
export type BuyBudget={
  reviewId:string;
  startingReserve:string;
  fraction:string;
  filledBuys:string;
};
function finiteNonNegative(v:Decimal.Value,name:string){
  const n=new Decimal(v);
  if(!n.isFinite()||n.lt(0))throw new Error("INVALID_SIG_BUDGET:"+name);
  return n;
}
function validate(b:BuyBudget){
  if(!/^\d{4}-Q[1-4]$/.test(b.reviewId))throw new Error("INVALID_SIG_BUDGET:reviewId");
  const reserve=finiteNonNegative(b.startingReserve,"startingReserve");
  const fraction=finiteNonNegative(b.fraction,"fraction");
  const filled=finiteNonNegative(b.filledBuys,"filledBuys");
  if(fraction.gt(1))throw new Error("INVALID_SIG_BUDGET:fraction");
  const maximum=reserve.mul(fraction);
  if(filled.gt(maximum))throw new Error("SIG_BUY_BUDGET_OVERFILLED");
  return {reserve,fraction,filled,maximum};
}
export function remainingSigBuyBudget(b:BuyBudget):string{
  const {filled,maximum}=validate(b);
  return maximum.minus(filled).toFixed();
}
/** Uses cumulative *confirmed* fills; proposals never spend the budget. */
export function recordSigBuyFill(b:BuyBudget,confirmedAmount:Decimal.Value):BuyBudget{
  const v=finiteNonNegative(confirmedAmount,"confirmedAmount");
  const {filled,maximum}=validate(b);
  const next=filled.plus(v);
  if(next.gt(maximum))throw new Error("SIG_BUY_BUDGET_OVERFILLED");
  return {...b,filledBuys:next.toFixed()};
}
export function affordableSigResearchBuy(b:BuyBudget,shortfall:Decimal.Value,availableReserve:Decimal.Value):string{
  const gap=finiteNonNegative(shortfall,"shortfall");
  const cash=finiteNonNegative(availableReserve,"availableReserve");
  return Decimal.min(gap,cash,new Decimal(remainingSigBuyBudget(b))).toFixed();
}
