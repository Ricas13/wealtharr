/**
 * Confirmation timestamps are broker execution facts, not the time a web form was submitted.
 * Keep out-of-order historical trades in the historical-import flow, where the entire ledger
 * can be revalidated; don't silently insert them before already accounted transactions.
 */
export function validatedFillTime(
  supplied:string|undefined,actionCreatedAt:Date,lastLedgerAt:Date|null,now:Date=new Date()
):Date {
  const fill=supplied?new Date(supplied):now;
  if(!Number.isFinite(fill.getTime())||fill.getTime()<Date.UTC(1990,0,1)||
    fill.getTime()>now.getTime()+60_000)throw new Error("INVALID_EXECUTION_TIMESTAMP");
  // A trade predating the instruction is not proof that the instruction was executed.
  if(fill.getTime()<actionCreatedAt.getTime()-5*60_000)throw new Error("EXECUTION_BEFORE_ACTION");
  if(lastLedgerAt&&fill.getTime()<lastLedgerAt.getTime())
    throw new Error("EXECUTION_OUT_OF_ORDER");
  return fill;
}
