import Decimal from "decimal.js";

/**
 * 9Sig 2026 COMMUNITY-RECONSTRUCTED safety rules, NOT an author-certified release.
 * Evidence: https://www.reddit.com/r/KellyLetter/comments/1s8473h/30_down_rule_price_point/
 * https://www.reddit.com/r/KellyLetter/comments/1q7e2v9/query_on_30_down_rule/
 * Author historical spike rule (2018):
 * https://jasonkelly.com/resources/strategies/
 *
 * Explicitly requires a caller-provided version; never used in the live registry.
 */
export type Community9SigProtection={
  startQuarter:number|null;
  skippedSellCount:number;
};
export type Community9SigDecision={
  signal:"BUY"|"SELL"|"HOLD";
  effectiveSignal:"BUY"|"SELL"|"HOLD";
  protection:Community9SigProtection;
  protectionActive:boolean;
  skipRemaining:number;
};
function validPrice(v:Decimal.Value){
  const n=new Decimal(v);
  if(!n.isFinite()||n.lte(0))throw new Error("INVALID_9SIG_REFERENCE_PRICE");
  return n;
}
export function assess2026Community9Sig30Down(input:{
  quarterIndex:number;
  currentTqqqClose:Decimal.Value;
  precedingEightTqqqQuarterCloses:readonly Decimal.Value[];
  signal:"BUY"|"SELL"|"HOLD";
  protection:Community9SigProtection;
}):Community9SigDecision{
  const {quarterIndex,signal,protection}=input;
  if(!Number.isInteger(quarterIndex)||quarterIndex<8||!Number.isInteger(protection.skippedSellCount)||
    protection.skippedSellCount<0||protection.skippedSellCount>2||
    (protection.startQuarter!==null&&(!Number.isInteger(protection.startQuarter)||protection.startQuarter>quarterIndex)))
    throw new Error("INVALID_9SIG_PROTECTION_STATE");
  if(input.precedingEightTqqqQuarterCloses.length!==8)
    throw new Error("9SIG_EIGHT_QUARTER_HISTORY_REQUIRED");
  const reference=Decimal.max(...input.precedingEightTqqqQuarterCloses.map(validPrice));
  const triggered=validPrice(input.currentTqqqClose).lte(reference.mul("0.70"));
  const inExisting=protection.startQuarter!==null&&quarterIndex-protection.startQuarter<8&&protection.skippedSellCount<2;
  // 2026 discussions do not resolve all re-arm/expiry/reset interactions.
  // No invented rearm when already in a completed or expired window.
  if(protection.startQuarter!==null&&!inExisting&&triggered)
    throw new Error("9SIG_REARM_AND_RESET_RULE_UNVERIFIED");
  const activated=protection.startQuarter===null&&triggered;
  const active=activated||inExisting;
  const skip=active&&signal==="SELL";
  const next=activated?{startQuarter:quarterIndex,skippedSellCount:skip?1:0}
    :skip?{startQuarter:protection.startQuarter,skippedSellCount:protection.skippedSellCount+1}:protection;
  return {signal,effectiveSignal:skip?"HOLD":signal,protection:next,
    protectionActive:active,skipRemaining:active?2-next.skippedSellCount:0};
}

/**
 * Author's 2018 documented spike-reset preconditions, evaluated from verified
 * quarter gain and AFTER ordinary quarterly rebalance weights. A spike
 * condition does not override 30 Down. Current rule version not certified.
 */
export function historical9SigSpikeReset(input:{
  previousQuarterClose:Decimal.Value;
  currentQuarterClose:Decimal.Value;
  afterOrdinaryRebalanceStockValue:Decimal.Value;
  afterOrdinaryRebalanceBondValue:Decimal.Value;
  in30DownNoSellPeriod:boolean;
}):{eligible:boolean;targetStockWeight:"0.60"|null}{
  const before=validPrice(input.previousQuarterClose);
  const after=validPrice(input.currentQuarterClose);
  const stock=new Decimal(input.afterOrdinaryRebalanceStockValue);
  const bond=new Decimal(input.afterOrdinaryRebalanceBondValue);
  if(!stock.isFinite()||!bond.isFinite()||stock.lt(0)||bond.lt(0)||stock.plus(bond).lte(0))
    throw new Error("INVALID_9SIG_POST_REBALANCE_VALUES");
  const weight=stock.div(stock.plus(bond));
  const eligible=after.gte(before.mul(2))&&weight.gte("0.60")&&weight.lte(1)&&!input.in30DownNoSellPeriod;
  return {eligible,targetStockWeight:eligible?"0.60":null};
}
