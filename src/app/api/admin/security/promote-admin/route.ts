import {z} from "zod";
import {sql} from "@/lib/db";
import {requireAdminWithMfa} from "@/lib/session";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {authFailure} from "@/lib/api-auth";
import {adminPromotionInput,recentAdminAuth,promotionTargetEligible} from "@/domain/admin-role-promotion";
import {notifySecurityEvent} from "@/lib/security-notice";

const headers={"cache-control":"no-store"};
export const dynamic="force-dynamic";

/** Explicit operator action for existing verified users with their own MFA.
 * No open invitation, no password creation, no role downgrade, no self-promotion.
 * Financial/corporate-action two-person controls are never bypassed.
 */
export async function POST(request:Request){
 try{
  assertSameOrigin(request);
  const actor=await requireAdminWithMfa();
  if(!recentAdminAuth(actor.authTime,Date.now()))
   return Response.json({error:"Sign out and sign in again with two-step verification before changing admin roles."},{status:403,headers});
  await consumeRateLimit("admin-role-promotion:"+actor.id,5,3600);
  const input=adminPromotionInput.parse(await request.json());
  const outcome=await sql.begin(async tx=>{
   // Recheck the actor inside the same transaction; a revoked admin cannot
   // grant privileges if their role or two-step enrolment changed mid-request.
   const acting=await tx.unsafe(
    "SELECT id FROM users WHERE id=$1::uuid AND role='ADMIN' AND mfa_enabled_at IS NOT NULL AND deleted_at IS NULL FOR UPDATE",
    [actor.id]
   );
   if(!acting.length)return {kind:"DENIED"} as const;
   const target=await tx.unsafe(
    "SELECT id,role,email_verified_at,mfa_enabled_at,deleted_at FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL FOR UPDATE",
    [input.email]
   );
   const user=target[0];
   if(!user||!promotionTargetEligible({
    actorId:actor.id,targetId:String(user.id),role:String(user.role),
    verified:Boolean(user.email_verified_at),mfaEnabled:Boolean(user.mfa_enabled_at),
    deleted:Boolean(user.deleted_at)
   }))return {kind:"NOT_ELIGIBLE"} as const;
   await tx.unsafe(
    "UPDATE users SET role='ADMIN',session_version=session_version+1,updated_at=now() WHERE id=$1::uuid AND role='USER'",
    [user.id]
   );
   await tx.unsafe(
    "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'admin.role.granted','user',$2,'{}'::jsonb)",
    [actor.id,String(user.id)]
   );
   return {kind:"PROMOTED",targetId:String(user.id)} as const;
  });
  if(outcome.kind==="DENIED")return Response.json({error:"Administrative access must be verified again."},{status:403,headers});
  if(outcome.kind==="NOT_ELIGIBLE")return Response.json({
   error:"This account is not eligible. It must already exist, verify its email and independently enable two-step sign-in."
  },{status:409,headers});
  // Best-effort independent notification; don't roll back an already committed
  // audit + session revocation if the email service is temporarily unavailable.
  const notificationSent=await notifySecurityEvent(outcome.targetId,"ADMIN_ROLE_GRANTED");
  return Response.json({ok:true,notificationSent,note:notificationSent?
   "The account owner has been notified and must sign in again with two-step verification.":
   "Role granted, but the security email could not be confirmed. Contact the account owner using an independent channel."},
   {headers});
 }catch(error){
  const authResponse=authFailure(error);
  if(authResponse)return authResponse;
  if(error instanceof z.ZodError)return Response.json({error:"Enter an existing valid email and type PROMOTE TO ADMIN exactly."},{status:400,headers});
  if(error instanceof Error&&error.message==="RATE_LIMITED")return Response.json({error:"Too many admin changes attempted. Try again later."},{status:429,headers});
  return Response.json({error:"Unable to promote this account."},{status:500,headers});
 }
}
