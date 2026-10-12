export type ActionStatus="CALCULATED"|"NOTIFIED"|"ACKNOWLEDGED"|"PARTIALLY_EXECUTED"|"EXECUTED"|"RECONCILED"|"CANCELLED"|"SUPERSEDED";
/** Statuses of an action that is still live: it can be shown, notified, acknowledged or executed. */
export const EXECUTABLE_ACTION_STATUSES=["CALCULATED","NOTIFIED","ACKNOWLEDGED"] as const;
/** The same list as an SQL fragment for `status IN (...)`; use it only in string-literal concatenations. */
export const EXECUTABLE_ACTION_STATUS_SQL=EXECUTABLE_ACTION_STATUSES.map((status)=>"'"+status+"'").join(",");
export function isExecutableActionStatus(status:string){return (EXECUTABLE_ACTION_STATUSES as readonly string[]).includes(status);}
const allowed:Record<ActionStatus,ActionStatus[]>={
  CALCULATED:["NOTIFIED","ACKNOWLEDGED","PARTIALLY_EXECUTED","EXECUTED","CANCELLED","SUPERSEDED"],
  NOTIFIED:["ACKNOWLEDGED","PARTIALLY_EXECUTED","EXECUTED","CANCELLED","SUPERSEDED"],
  ACKNOWLEDGED:["PARTIALLY_EXECUTED","EXECUTED","CANCELLED","SUPERSEDED"],
  PARTIALLY_EXECUTED:[],
  EXECUTED:["RECONCILED"],
  RECONCILED:[],
  CANCELLED:["CALCULATED"],
  SUPERSEDED:["CALCULATED"]
};
export function canTransitionAction(from:ActionStatus,to:ActionStatus){return allowed[from].includes(to);}
export function assertActionTransition(from:ActionStatus,to:ActionStatus){if(!canTransitionAction(from,to))throw new Error("INVALID_ACTION_TRANSITION");}

export function actionRecalculationDisposition(previous:ActionStatus|null){
  if(previous==null)return {status:"CALCULATED" as const,shouldNotify:true};
  if(previous==="CANCELLED"||previous==="SUPERSEDED")return {status:"CALCULATED" as const,shouldNotify:true};
  return {status:previous,shouldNotify:false};
}
