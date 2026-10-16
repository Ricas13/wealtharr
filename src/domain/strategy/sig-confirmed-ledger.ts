import Decimal from "decimal.js";
export type SigExecutedLedgerRow={
  id:string;correctionOfEventId:string|null;eventType:string;
  currency:string;cashAmount:string;feeAmount:string;occurredAt:Date;
};
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
    safeSellGross:new Decimal(0),feeTotal:new Decimal(0),lastSafeSellNet:null as Decimal|null,lastSafeSellFee:null as Decimal|null};
  let lastSafeSaleAt=Number.NEGATIVE_INFINITY;
  for(const r of rows){
    const at=r.occurredAt instanceof Date?r.occurredAt.getTime():NaN;
    if(!Number.isFinite(at))throw new Error("SIG_CONFIRMED_LEDGER_INVALID");
    if(at<=reviewStarted.getTime()||corrected.has(r.id)||r.eventType==="CORRECTION")continue;
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
      if(stock)out.stockSellGross=out.stockSellGross.plus(cash);
      else {
        out.safeSellGross=out.safeSellGross.plus(cash);
        if(at>=lastSafeSaleAt){
          lastSafeSaleAt=at;
          out.lastSafeSellNet=cash.minus(fee);
          out.lastSafeSellFee=fee;
        }
      }
    }
  }
  return out;
}
