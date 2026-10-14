import Decimal from "decimal.js";
import {projectGrowthSig,type GrowthSig} from "./sig-research";

/**
 * Deterministic *research* quarter execution simulation. No broker instructions.
 * Explicit cap is a user-provided hypothesis; it is NOT evidence of the
 * currently published Jason Kelly rule for any given Sig variant.
 */
export type SigSimState={
  quarter:string;
  phase:"OPEN"|"CLOSED";
  startAnchor:string;
  target:string;
  stockValue:string;
  reserveValue:string;
  reserveAtOpen:string;
  buyingPowerFraction:string;
  boughtThisQuarter:string;
  soldThisQuarter:string;
  totalFees:string;
  fills:number;
};
function nonnegative(v:Decimal.Value,field:string):Decimal{
  const n=new Decimal(v);
  if(!n.isFinite()||n.lt(0))throw new Error("INVALID_SIG_SIM:"+field);
  return n;
}
export function openSigResearchQuarter(i:{
  variant:GrowthSig;quarter:string;anchor:Decimal.Value;
  newCash:Decimal.Value;stockValue:Decimal.Value;reserveValue:Decimal.Value;
  buyingPowerFraction:Decimal.Value;
}):SigSimState{
  if(!/^\d{4}-Q[1-4]$/.test(i.quarter))throw new Error("INVALID_SIG_SIM:quarter");
  const reserve=nonnegative(i.reserveValue,"reserveValue");
  const fraction=nonnegative(i.buyingPowerFraction,"buyingPowerFraction");
  if(fraction.gt(1))throw new Error("INVALID_SIG_SIM:buyingPowerFraction");
  const stock=nonnegative(i.stockValue,"stockValue");
  const contribution=nonnegative(i.newCash,"newCash");
  const p=projectGrowthSig({variant:i.variant,precedingAnchor:i.anchor,newCash:contribution,observedExposure:stock});
  return {quarter:i.quarter,phase:"OPEN",startAnchor:nonnegative(i.anchor,"anchor").toFixed(),
    target:p.target,stockValue:stock.toFixed(),reserveValue:reserve.plus(contribution).toFixed(),
    reserveAtOpen:reserve.plus(contribution).toFixed(),buyingPowerFraction:fraction.toFixed(),
    boughtThisQuarter:"0",soldThisQuarter:"0",totalFees:"0",fills:0};
}
/** Explicit confirmed value transfer; cash fees charged from reserve, not fabricated returns. */
export function recordSigResearchFill(s:SigSimState,i:{
  side:"BUY"|"SELL";grossValue:Decimal.Value;fee:Decimal.Value;
}):SigSimState{
  if(s.phase!=="OPEN")throw new Error("SIG_SIM_REVIEW_CLOSED");
  const gross=nonnegative(i.grossValue,"grossValue"),fee=nonnegative(i.fee,"fee");
  if(gross.lte(0))throw new Error("INVALID_SIG_SIM:zeroFill");
  const stock=nonnegative(s.stockValue,"state.stockValue");
  const reserve=nonnegative(s.reserveValue,"state.reserveValue");
  const bought=nonnegative(s.boughtThisQuarter,"state.boughtThisQuarter");
  const sold=nonnegative(s.soldThisQuarter,"state.soldThisQuarter");
  const fraction=nonnegative(s.buyingPowerFraction,"state.buyingPowerFraction");
  const budget=nonnegative(s.reserveAtOpen,"state.reserveAtOpen").mul(fraction);
  if(i.side==="BUY"&&(bought.plus(gross).gt(budget)||gross.plus(fee).gt(reserve)))
    throw new Error("SIG_SIM_BUY_BUDGET_EXCEEDED");
  if(i.side==="SELL"&&(gross.gt(stock)||fee.gt(reserve.plus(gross))))
    throw new Error("SIG_SIM_SELL_EXCEEDS_HOLDINGS");
  return {...s,stockValue:(i.side==="BUY"?stock.plus(gross):stock.minus(gross)).toFixed(),
    reserveValue:(i.side==="BUY"?reserve.minus(gross).minus(fee):reserve.plus(gross).minus(fee)).toFixed(),
    boughtThisQuarter:(i.side==="BUY"?bought.plus(gross):bought).toFixed(),
    soldThisQuarter:(i.side==="SELL"?sold.plus(gross):sold).toFixed(),
    totalFees:nonnegative(s.totalFees,"state.totalFees").plus(fee).toFixed(),fills:s.fills+1};
}
/**
 * Close even when the desired order could not be fully funded. This is an
 * explicitly chosen simulation rule; the next-quarter anchor remains an
 * external, method-specific decision and cannot be inferred from this state.
 */
export function closeSigResearchQuarter(s:SigSimState):SigSimState{
  if(s.phase!=="OPEN")throw new Error("SIG_SIM_REVIEW_CLOSED");
  return {...s,phase:"CLOSED"};
}
