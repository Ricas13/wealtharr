import {selectConfirmedStrategyLots} from "@/domain/brokerage/trading212-readonly";

/** A broker's account-wide order history stays inside the request.
 * Expose only counts for explicitly assigned trade IDs, never unrelated rows.
 * "Found" is NOT a verified fill: only an explicit FILLED status counts.
 */
export function summariseSelectedBrokerOrders(
 orders:readonly {id:string|number;status?:unknown}[],
 assignedIds:ReadonlySet<string>
){
 const selected=selectConfirmedStrategyLots(orders,assignedIds);
 if(selected.ambiguous)return {
  result:"AMBIGUOUS" as const,linked:assignedIds.size,filled:0,needsReview:assignedIds.size,missing:0
 };
 const filled=selected.matched.filter(item=>item.status==="FILLED").length;
 return {
  result:"OBSERVED" as const,linked:assignedIds.size,
  filled,needsReview:selected.matched.length-filled,
  missing:selected.missing.length
 };
}
