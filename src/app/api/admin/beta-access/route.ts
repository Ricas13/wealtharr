import {z} from "zod";
import {requireAdmin} from "@/lib/session";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {authFailure} from "@/lib/api-auth";
import {sql} from "@/lib/db";
import {enforceStrategyEntitlements} from "@/lib/entitlement-service";

const grantSchema=z.object({
 userId:z.string().uuid(),
 planSlug:z.enum(["investor","pro"]),
 days:z.number().int().min(7).max(180)
});
const revokeSchema=z.object({userId:z.string().uuid()});

async function applyEntitlementChange(userId:string,active:boolean){
 try {
  const updated=await enforceStrategyEntitlements(userId);
  return Response.json({ok:true,active,paused:updated.paused},{headers:{"cache-control":"no-store"}});
 }catch{
  // The worker also checks access. Do not misreport a failed immediate enforcement as success.
  return Response.json({ok:true,active,enforcementPending:true},{status:202,headers:{"cache-control":"no-store"}});
 }
}

// Complimentary access only; never changes paid subscriptions, charges, or issuer eligibility.
export async function POST(request:Request){
 try{
  assertSameOrigin(request);
  const admin=await requireAdmin();
  await consumeRateLimit("admin-beta-access:"+admin.id,60,3600);
  const input=grantSchema.parse(await request.json());
  const result=await sql.begin(async tx=>{
   const users=await tx.unsafe("SELECT id,role FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[input.userId]);
   if(!users[0])return "NO_USER";
   if(users[0].role==="ADMIN")return "ADMIN_NOT_ELIGIBLE";
   const active=await tx.unsafe(
    "SELECT 1 FROM subscriptions WHERE user_id=$1 AND status IN ('ACTIVE','TRIALING','PAST_DUE','UNPAID','INCOMPLETE','PAUSED') LIMIT 1",
    [input.userId]
   );
   if(active[0])return "ALREADY_SUBSCRIBED";
   const plans=await tx.unsafe(
    "SELECT id FROM plans WHERE slug=$1 AND archived=false LIMIT 1",[input.planSlug]
   );
   if(!plans[0])return "NO_PLAN";
   await tx.unsafe(
    "INSERT INTO private_beta_grants(user_id,plan_id,expires_at,granted_by) " +
    "VALUES($1,$2,now()+($3::integer*interval '1 day'),$4) " +
    "ON CONFLICT(user_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,expires_at=EXCLUDED.expires_at,"+
    "granted_at=now(),granted_by=EXCLUDED.granted_by,revoked_at=NULL",
    [input.userId,plans[0].id,input.days,admin.id]
   );
   await tx.unsafe(
    "INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,metadata) " +
    "VALUES($1,'beta.access-granted','user',$2,$3::jsonb)",
    [admin.id,input.userId,JSON.stringify({planSlug:input.planSlug,days:input.days,complimentary:true})]
   );
   return "OK";
  });
  if(result==="NO_USER"||result==="NO_PLAN")return Response.json({error:"Customer or plan not found."},{status:404});
  if(result==="ADMIN_NOT_ELIGIBLE"||result==="ALREADY_SUBSCRIBED")
   return Response.json({error:"Beta grants cannot replace a paying customer or administrator plan."},{status:409});
  return applyEntitlementChange(input.userId,true);
 }catch(e){
  const denied=authFailure(e);if(denied)return denied;
  if(e instanceof z.ZodError)return Response.json({error:"Choose a valid customer, plan and duration (7–180 days)."},{status:400});
  if(e instanceof Error&&e.message==="RATE_LIMITED")return Response.json({error:"Too many changes."},{status:429});
  return Response.json({error:"Could not grant beta access."},{status:500});
 }
}
export async function DELETE(request:Request){
 try{
  assertSameOrigin(request);
  const admin=await requireAdmin();
  await consumeRateLimit("admin-beta-access:"+admin.id,60,3600);
  const input=revokeSchema.parse(await request.json());
  const result=await sql.begin(async tx=>{
   const users=await tx.unsafe("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[input.userId]);
   if(!users[0])return "NO_USER";
   const changed=await tx.unsafe(
    "UPDATE private_beta_grants SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL RETURNING user_id",[input.userId]
   );
   if(!changed[0])return "NO_GRANT";
   await tx.unsafe(
    "INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,metadata) " +
    "VALUES($1,'beta.access-revoked','user',$2,$3::jsonb)",
    [admin.id,input.userId,JSON.stringify({complimentary:true})]
   );
   return "OK";
  });
  if(result==="NO_USER"||result==="NO_GRANT")return Response.json({error:"Customer or active grant not found."},{status:404});
  return applyEntitlementChange(input.userId,false);
 }catch(e){
  const denied=authFailure(e);if(denied)return denied;
  if(e instanceof z.ZodError)return Response.json({error:"Invalid customer."},{status:400});
  if(e instanceof Error&&e.message==="RATE_LIMITED")return Response.json({error:"Too many changes."},{status:429});
  return Response.json({error:"Could not revoke beta access."},{status:500});
 }
}
