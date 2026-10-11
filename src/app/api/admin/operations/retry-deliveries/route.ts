import {z} from "zod";
import {requireAdmin} from "@/lib/session";
import {assertSameOrigin} from "@/lib/security";
import {sql} from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
const schema=z.object({channel:z.enum(["EMAIL","DISCORD","TELEGRAM"]).optional(),limit:z.number().int().min(1).max(25).default(10),includeDeadLetter:z.boolean().default(false)});
/** An operator may advance a *bounded* set of pending failed deliveries.
 * Never resend SENT, CANCELLED or action-superseded notifications.
 * Existing worker re-validates entitlement and active action before sending.
 */
export async function POST(request:Request){
 try{
  assertSameOrigin(request);
  const admin=await requireAdmin();
  const p=schema.parse(await request.json());
  const result=await sql.begin(async(tx)=>{
   const selected=await tx.unsafe(
    "SELECT d.id FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id "+
    "LEFT JOIN actions a ON a.id=n.action_id "+
    "WHERE ((d.status='PENDING' AND d.last_error_code IN ('DELIVERY_FAILED','ACTION_REVALIDATION_FAILED')) OR ($3::boolean AND d.status='DEAD_LETTER')) "+
    "AND ($1::text IS NULL OR d.channel=$1) "+
    "AND (n.action_id IS NULL OR (a.status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') "+
    "AND n.id=(SELECT newest.id FROM notifications newest WHERE newest.action_id=n.action_id ORDER BY newest.created_at DESC,newest.id DESC LIMIT 1))) "+
    "ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT $2",
    [p.channel??null,p.limit,p.includeDeadLetter]);
   const ids=selected.map(r=>String(r.id));
   if(ids.length){
    await tx.unsafe("UPDATE notification_deliveries SET status='PENDING',attempt_count=CASE WHEN status='DEAD_LETTER' THEN 0 ELSE attempt_count END,"+
     "next_attempt_at=now(),last_error_code=NULL,updated_at=now() WHERE id = ANY($1::uuid[]) AND status IN ('PENDING','DEAD_LETTER')",[ids]);
   }
   await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,metadata) VALUES ($1,'notification-delivery.retry-requested','notification_delivery',$2::jsonb)",[admin.id,JSON.stringify({channel:p.channel??"ALL",requested:p.limit,includeDeadLetter:p.includeDeadLetter,queued:ids.length})]);
   return ids.length;
  });
  return Response.json({ok:true,queued:result},{headers:{"cache-control":"no-store"}});
 }catch(e){const denied=authFailure(e);if(denied)return denied;
  if(e instanceof z.ZodError)return Response.json({error:"Invalid retry request."},{status:400});
  return Response.json({error:"Could not queue delivery retries."},{status:500});
 }
}
