import Decimal from "decimal.js";
import {selectConfirmedStrategyLots} from "./trading212-readonly";

/** Only externally linked, user-confirmed orders are admitted to reconciliation.
 * Never aggregate an entire ticker, position, account balance or unrelated orders.
 * This is evidence, NOT an instruction to alter the immutable Wealtharr ledger.
 */
export type ConfirmedLink={
  externalTradeId:string;ledgerEventId:string;side:"BUY"|"SELL";quantity:string;
};
export type BrokerOrder={
  id:string|number;side?:unknown;status?:unknown;filledQuantity?:unknown;ticker?:unknown;
};
export type BrokerOrderCheck={
  externalTradeId:string;ledgerEventId:string;
  status:"MATCH"|"MISMATCH"|"MISSING"|"UNSETTLED"|"AMBIGUOUS";
  reason:string;observedQuantity:string|null;
};
export function reconcileConfirmedOrders(links:readonly ConfirmedLink[],orders:readonly BrokerOrder[]):BrokerOrderCheck[]{
  if(orders.some(order=>typeof order.id==="number"&&!Number.isSafeInteger(order.id)))
    throw new Error("BROKER_ORDER_ID_PRECISION_UNSAFE");
  const ids=new Set(links.map(l=>l.externalTradeId));
  if(ids.size!==links.length)throw new Error("BROKER_DUPLICATE_ASSIGNED_ID");
  const {matched,missing,ambiguous}=selectConfirmedStrategyLots(orders,ids);
  if(ambiguous)return links.map(l=>({
    externalTradeId:l.externalTradeId,ledgerEventId:l.ledgerEventId,status:"AMBIGUOUS" as const,
    reason:"Provider returned duplicate trade IDs. No ownership or quantity may be inferred.",observedQuantity:null
  }));
  const byId=new Map(matched.map(o=>[String(o.id),o]));
  return links.map(link=>{
    const base={externalTradeId:link.externalTradeId,ledgerEventId:link.ledgerEventId};
    const missingOrder=missing.includes(link.externalTradeId)||!byId.has(link.externalTradeId);
    if(missingOrder)return {...base,status:"MISSING" as const,
      reason:"Linked order missing from complete provider history. Reconciliation required.",observedQuantity:null};
    const order=byId.get(link.externalTradeId)!;
    if(order.status!=="FILLED"&&order.status!=="PARTIALLY_FILLED")
      return {...base,status:"UNSETTLED" as const,
        reason:"Provider does not confirm the order as filled.",observedQuantity:null};
    if(order.side!=="BUY"&&order.side!=="SELL")
      return {...base,status:"MISMATCH" as const,
        reason:"Provider order side is unknown.",observedQuantity:null};
    let observed:Decimal,expected:Decimal;
    try{
      observed=new Decimal(String(order.filledQuantity));
      expected=new Decimal(link.quantity).abs();
    }catch{return {...base,status:"MISMATCH" as const,
      reason:"Provider quantity is invalid.",observedQuantity:null};}
    if(!observed.isFinite()||!expected.isFinite()||observed.lt(0)||expected.lte(0)||
       observed.decimalPlaces()>12||expected.decimalPlaces()>12)
      return {...base,status:"MISMATCH" as const,
        reason:"Provider quantity is invalid.",observedQuantity:null};
    if(order.side!==link.side||!observed.eq(expected))
      return {...base,status:"MISMATCH" as const,
        reason:"Confirmed provider side or quantity differs from the immutable ledger.",observedQuantity:observed.toString()};
    return {...base,status:"MATCH" as const,reason:"Confirmed order side and quantity match.",observedQuantity:observed.toString()};
  });
}
