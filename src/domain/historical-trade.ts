import {LedgerDecimal as Decimal} from "./ledger-decimal";
import { localDateInZone } from "./schedule";

/**
 * Supported exchange identifiers are deliberately explicit; an unknown venue is
 * not silently treated as UTC because that can select the wrong instrument line.
 */
const exchangeZones: Record<string,string> = {
  NASDAQ:"America/New_York", XNAS:"America/New_York", NYSE:"America/New_York",
  XNYS:"America/New_York", NYSEARCA:"America/New_York", ARCA:"America/New_York",
  AMEX:"America/New_York", BATS:"America/New_York",
  LSE:"Europe/London", XLON:"Europe/London",
  XETRA:"Europe/Berlin", XETR:"Europe/Berlin", FRA:"Europe/Berlin",
  EURONEXTPARIS:"Europe/Paris", XPAR:"Europe/Paris"
};

export function exchangeTradingDate(at:Date,exchange:string):string{
  if(!Number.isFinite(at.getTime()))throw new Error("INVALID_TRADE_TIMESTAMP");
  const zone=exchangeZones[exchange.toUpperCase()];
  if(!zone)throw new Error("UNSUPPORTED_EXCHANGE_TIMEZONE");
  return localDateInZone(at,zone);
}

export type HistoricalBrokerFill={
  side:"BUY"|"SELL"; quantity:string; unitPrice:string; fee:string;
  executedAt:Date; currency:string;
};

/** Broker confirmations, not indicative last prices, determine actual cash and units. */
export function historicalBrokerFill(input:HistoricalBrokerFill,now=new Date()){
  if(!Number.isFinite(input.executedAt.getTime())||input.executedAt.getTime()>now.getTime()
    ||input.executedAt.getTime()<Date.UTC(1990,0,1))throw new Error("INVALID_TRADE_TIMESTAMP");
  if(!/^[A-Z]{3}$/.test(input.currency))throw new Error("INVALID_TRADE_CURRENCY");
  const valid=(text:string,scale:number)=>new RegExp("^\\d+(?:\\.\\d{1,"+scale+"})?$").test(text);
  if(!valid(input.quantity,12)||!valid(input.unitPrice,10)||!valid(input.fee,8))
    throw new Error("INVALID_TRADE_DECIMAL");
  const quantity=new Decimal(input.quantity);
  const unitPrice=new Decimal(input.unitPrice);
  const fee=new Decimal(input.fee);
  if(!quantity.isFinite()||quantity.lte(0)||!unitPrice.isFinite()||unitPrice.lte(0)
    ||!fee.isFinite()||fee.lt(0))throw new Error("INVALID_TRADE_AMOUNT");
  const gross=quantity.mul(unitPrice);
  if(gross.decimalPlaces()>8)throw new Error("TRADE_NOTIONAL_PRECISION_UNSUPPORTED");
  if(quantity.gte("1000000000000000000")||unitPrice.gte("100000000000000")||
    fee.gte("10000000000000000")||gross.gte("10000000000000000"))throw new Error("TRADE_TOO_LARGE");
  return {
    quantity:input.side==="BUY"?quantity:quantity.neg(),
    cashAmount:input.side==="BUY"?gross.neg():gross,
    feeAmount:fee,
    grossNotional:gross,
    currency:input.currency
  };
}
