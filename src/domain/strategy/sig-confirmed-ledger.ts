import Decimal from "decimal.js";
export type SigExecutedLedgerRow={
  id:string;correctionOfEventId:string|null;eventType:string;
  currency:string;cashAmount:string;feeAmount:string;occurredAt:Date;
};
/** Materialize ONLY uncorrected confirmed execution events since last completed review. */
export function confirmedSigReviewTrades(
  rows:readonly SigExecutedLedgerRow[], reviewStarted:Date, currency:string,currentCash:Decimal
){
  if(!Number.isFinite(reviewStarted.getTime())||!currentCash.isFinite()||currentCash.lt(0))
    throw new Error("SIG_CONFIRMED_LEDGER_INVALID");
  const corrected=new Set(rows.filter(r=>r.correctionOfEventId).map(r=>r.correctionOfEventId));
  let buyGross=new Decimal(0),sellGross=new Decimal(0),feeTotal=new Decimal(0);
  for(const r of rows){
    if(r.occurredAt<=reviewStarted||corrected.has(r.id)||r.eventType==="CORRECTION")continue;
    if(!["BUY","SELL","FEE"].includes(r.eventType))continue;
    if(r.currency.toUpperCase()!==currency.toUpperCase())
      throw new Error("SIG_EXECUTION_CURRENCY_MISMATCH");
    const cash=new Decimal(r.cashAmount),fee=new Decimal(r.feeAmount);
    if(!cash.isFinite()||!fee.isFinite()||fee.lt(0))
      throw new Error("SIG_CONFIRMED_LEDGER_INVALID");
    if(r.eventType==="BUY"){
      if(cash.gte(0))throw new Error("SIG_CONFIRMED_LEDGER_INVALID");
      buyGross=buyGross.minus(cash);
    }else if(r.eventType==="SELL"){
      if(cash.lte(0))throw new Error("SIG_CONFIRMED_LEDGER_INVALID");
      sellGross=sellGross.plus(cash);
    }
    feeTotal=feeTotal.plus(fee);
  }
  const reserveBeforeTrades=currentCash.plus(buyGross).minus(sellGross).plus(feeTotal);
  if(reserveBeforeTrades.lt(0))throw new Error("SIG_REVIEW_RESERVE_INCONSISTENT");
  return {buyGross,sellGross,feeTotal,reserveBeforeTrades};
}

export type SigExposureLedgerRow=SigExecutedLedgerRow&{exposure:string|null};
/**
 * Per-sleeve confirmed fills of the current review. Rows are attributed to a managed sleeve by the
 * exposure of their instrument; an executed trade of any other (or unmapped) exposure fails closed.
 */
export function sigReviewTradesBySleeve(
  rows:readonly SigExposureLedgerRow[],reviewStarted:Date,currency:string,stockExposure:string,safeExposure:string
){
  if(!Number.isFinite(reviewStarted.getTime()))throw new Error("SIG_CONFIRMED_LEDGER_INVALID");
  const corrected=new Set(rows.filter(r=>r.correctionOfEventId).map(r=>r.correctionOfEventId));
  const out={stockBuyGross:new Decimal(0),stockSellGross:new Decimal(0),safeBuyGross:new Decimal(0),
    safeSellGross:new Decimal(0),feeTotal:new Decimal(0)};
  for(const r of rows){
    if(r.occurredAt<=reviewStarted||corrected.has(r.id)||r.eventType==="CORRECTION")continue;
    if(!["BUY","SELL","FEE"].includes(r.eventType))continue;
    if(r.currency.toUpperCase()!==currency.toUpperCase())throw new Error("SIG_EXECUTION_CURRENCY_MISMATCH");
    const cash=new Decimal(r.cashAmount),fee=new Decimal(r.feeAmount);
    if(!cash.isFinite()||!fee.isFinite()||fee.lt(0))throw new Error("SIG_CONFIRMED_LEDGER_INVALID");
    out.feeTotal=out.feeTotal.plus(fee);
    if(r.eventType==="FEE")continue;
    const stock=r.exposure===stockExposure,safe=r.exposure===safeExposure;
    if(!stock&&!safe)throw new Error("SIG_UNMANAGED_EXECUTION");
    if(r.eventType==="BUY"){
      if(cash.gte(0))throw new Error("SIG_CONFIRMED_LEDGER_INVALID");
      if(stock)out.stockBuyGross=out.stockBuyGross.minus(cash);else out.safeBuyGross=out.safeBuyGross.minus(cash);
    }else{
      if(cash.lte(0))throw new Error("SIG_CONFIRMED_LEDGER_INVALID");
      if(stock)out.stockSellGross=out.stockSellGross.plus(cash);else out.safeSellGross=out.safeSellGross.plus(cash);
    }
  }
  return out;
}
