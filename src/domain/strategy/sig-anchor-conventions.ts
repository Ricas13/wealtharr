import Decimal from "decimal.js";

/**
 * Explicitly versioned 9Sig quarter anchor selection. The two algorithms
 * below are NOT interchangeable after a capped/unfilled trade:
 *
 * post-fill: r/KellyLetter and r/TQQQ community account of current method.
 * prior-target: alternative public simulators and earlier plan examples.
 *
 * This module surfaces the incompatibility; a strategy version MUST choose
 * an independently verified convention before customer orders are allowed.
 */
export type SigAnchorConvention="CONFIRMED_POST_FILL"|"PRECEDING_SIGNAL_TARGET";
export type SigAnchorInput={
  convention:SigAnchorConvention;
  precedingTarget:Decimal.Value;
  confirmedPostFillStockValue:Decimal.Value;
  nextQuarterCashAdded:Decimal.Value;
  rate:Decimal.Value;
};
export function nextSigQuarterTarget(i:SigAnchorInput):{
  anchor:string;growth:string;contributionsAddedToTarget:string;target:string;
}{
  const val=(v:Decimal.Value,field:string)=>{
    const n=new Decimal(v);
    if(!n.isFinite()||n.lt(0))throw new Error("SIG_ANCHOR_INVALID:"+field);
    return n;
  };
  const previous=val(i.precedingTarget,"precedingTarget");
  const afterFill=val(i.confirmedPostFillStockValue,"confirmedPostFillStockValue");
  const cash=val(i.nextQuarterCashAdded,"nextQuarterCashAdded");
  const rate=val(i.rate,"rate");
  if(rate.gt(1))throw new Error("SIG_ANCHOR_INVALID:rate");
  if(i.convention!=="CONFIRMED_POST_FILL"&&i.convention!=="PRECEDING_SIGNAL_TARGET")
    throw new Error("SIG_ANCHOR_CONVENTION_REQUIRED");
  const anchor=i.convention==="CONFIRMED_POST_FILL"?afterFill:previous;
  const growth=anchor.mul(rate);
  const increment=cash.div(2);
  return {anchor:anchor.toFixed(),growth:growth.toFixed(),contributionsAddedToTarget:increment.toFixed(),
    target:anchor.plus(growth).plus(increment).toFixed()};
}
