import {createHash} from "node:crypto";
import type {ConfirmedLink} from "./strategy-reconciliation";

/** Evidence is strategy-scoped. Hash identifiers and ledger quantities, never unassigned broker holdings. */
export function confirmedLinkFingerprint(links:readonly ConfirmedLink[]):string{
 const canonical=links.map(row=>[row.externalTradeId,row.ledgerEventId,row.side,row.quantity].join("\u0000")).sort();
 return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function brokerSyncDisplayStatus(
 currentStatus:string, lastSyncedAt:Date|string|null|undefined,
 intervalMinutes:number, recordedFingerprint:string|undefined, currentFingerprint:string,
 now:Date=new Date()
):string{
 // A check that found nothing linked is out of date as soon as a trade is linked.
 if(currentStatus==="NO_LINKED_TRADES")
  return recordedFingerprint===currentFingerprint?currentStatus:"NEEDS_RECONCILIATION";
 if(currentStatus!=="VERIFIED")return currentStatus;
 // A newly linked, reversed or corrected trade invalidates previously matched evidence.
 if(!recordedFingerprint||recordedFingerprint!==currentFingerprint)return "NEEDS_RECONCILIATION";
 const last=lastSyncedAt?new Date(lastSyncedAt).getTime():NaN;
 const window=Math.max(5,Math.min(1440,Number.isFinite(intervalMinutes)?intervalMinutes:60))*60_000;
 if(!Number.isFinite(last)||last>now.getTime()||now.getTime()-last>window)return "STALE";
 return currentStatus;
}
