import Decimal from "decimal.js";

/**
 * 9Sig 2026 COMMUNITY-RECONSTRUCTED safety rules, NOT an author-certified release.
 * Evidence: https://www.reddit.com/r/KellyLetter/comments/1s8473h/30_down_rule_price_point/
 * https://www.reddit.com/r/KellyLetter/comments/1q7e2v9/query_on_30_down_rule/
 * Author historical spike rule (2018):
 * https://jasonkelly.com/resources/strategies/
 *
 * IMPORTANT: October 2026 BestFolio claims a SPY trigger in 6Sig/9Sig,
 * whereas March 2026 r/KellyLetter participants report TQQQ. The benchmark
 * is NOT verified: this models only that specific forum reconstruction.\n * Never invoke as the author's certified signal or live registry engine.
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
export type SigProtectionParams={triggerRatio?:Decimal.Value;skipCap?:number};
/**
 * 30 Down protection. Owner decision (2026-10): when a window has run out (skips used or 8 quarters
 * elapsed) while the price is still below the line, normal trading RESUMES; a new window can only start
 * after the price has first closed back above the line (which resets the state).
 */
export function assess2026Community9Sig30Down(input:{
  quarterIndex:number;
  currentTqqqClose:Decimal.Value;
  precedingEightTqqqQuarterCloses:readonly Decimal.Value[];
  signal:"BUY"|"SELL"|"HOLD";
  protection:Community9SigProtection;
}&SigProtectionParams):Community9SigDecision{
  const {quarterIndex,signal,protection}=input;
  const cap=input.skipCap??2;
  if(!Number.isInteger(cap)||cap<1||cap>8)throw new Error("INVALID_9SIG_PROTECTION_STATE");
  if(!Number.isInteger(quarterIndex)||quarterIndex<8||!Number.isInteger(protection.skippedSellCount)||
    protection.skippedSellCount<0||protection.skippedSellCount>cap||
    (protection.startQuarter!==null&&(!Number.isInteger(protection.startQuarter)||protection.startQuarter>quarterIndex)))
    throw new Error("INVALID_9SIG_PROTECTION_STATE");
  if(input.precedingEightTqqqQuarterCloses.length!==8)
    throw new Error("9SIG_EIGHT_QUARTER_HISTORY_REQUIRED");
  const reference=Decimal.max(...input.precedingEightTqqqQuarterCloses.map(validPrice));
  const triggered=validPrice(input.currentTqqqClose).lte(reference.mul(input.triggerRatio??"0.70"));
  const inExisting=protection.startQuarter!==null&&quarterIndex-protection.startQuarter<8&&protection.skippedSellCount<cap;
  const spent=protection.startQuarter!==null&&!inExisting;
  // A spent window followed by a close above the line re-arms the protection.
  const base:Community9SigProtection=spent&&!triggered?{startQuarter:null,skippedSellCount:0}:protection;
  const activated=base.startQuarter===null&&triggered;
  const active=activated||inExisting;
  const skip=active&&signal==="SELL";
  const next=activated?{startQuarter:quarterIndex,skippedSellCount:skip?1:0}
    :skip?{startQuarter:base.startQuarter,skippedSellCount:base.skippedSellCount+1}:base;
  return {signal,effectiveSignal:skip?"HOLD":signal,protection:next,
    protectionActive:active,skipRemaining:active?cap-next.skippedSellCount:0};
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
