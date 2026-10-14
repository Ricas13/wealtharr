/** Strategy-only read model: confirmed broker trade claims, not live brokerage
 * balances, active orders or proof of an independent provider sync.
 */
export type StrategyBrokerClaim={
 provider:string;externalTradeId:string;eventType:string;occurredAt:Date;quantity:string;currency:string;
};
const safely=(value:string)=>value.replace(/[\r\n\t]/g," ").slice(0,120);
export function brokerClaimPresentation(row:StrategyBrokerClaim){
 return {
  provider:row.provider==="TRADING212"?"Trading 212":"Other broker",
  tradeId:safely(row.externalTradeId),
  direction:row.eventType==="BUY"?"Buy":row.eventType==="SELL"?"Sell":"Unclassified",
  quantity:safely(row.quantity),
  currency:safely(row.currency.toUpperCase()),
  occurredAt:row.occurredAt
 };
}
