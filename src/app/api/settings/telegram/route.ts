import {randomBytes} from "node:crypto";
import {requireUser} from "@/lib/session";
import {assertNotificationAllowed} from "@/lib/entitlement-service";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {sql} from "@/lib/db";
import {hashTelegramLinkToken} from "@/domain/telegram";
import {authFailure} from "@/lib/api-auth";

export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store"};
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    await consumeRateLimit("telegram-connect:"+user.id,5,15*60);
    await assertNotificationAllowed(user.id,"TELEGRAM");
    const bot=process.env.TELEGRAM_BOT_USERNAME;
    if(!bot||!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(bot)||
      !process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_WEBHOOK_SECRET)
      return Response.json({error:"Telegram is not configured by the administrator."},{status:503,headers});
    const token=randomBytes(24).toString("hex");
    await sql.begin(async tx=>{
      await tx.unsafe("DELETE FROM telegram_link_tokens WHERE user_id=$1 AND used_at IS NULL",[user.id]);
      await tx.unsafe("INSERT INTO telegram_link_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '15 minutes')",[user.id,hashTelegramLinkToken(token)]);
    });
    return Response.json({ok:true,url:"https://t.me/"+bot+"?start="+token,expiresInMinutes:15},{headers});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof Error&&error.message==="CHANNEL_NOT_IN_PLAN")return Response.json({error:"Telegram is not included in your current plan."},{status:403,headers});
    if(error instanceof Error&&error.message==="RATE_LIMITED")return Response.json({error:"Too many connection requests."},{status:429,headers});
    return Response.json({error:"Could not prepare Telegram connection."},{status:500,headers});}
}
export async function DELETE(request:Request){
  try{assertSameOrigin(request);const user=await requireUser();
    await sql.begin(async tx=>{
      await tx.unsafe("DELETE FROM telegram_link_tokens WHERE user_id=$1",[user.id]);
      await tx.unsafe("DELETE FROM notification_endpoints WHERE user_id=$1 AND channel='TELEGRAM'",[user.id]);
      await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type) VALUES ($1,'telegram.disconnected','notification_endpoint')",[user.id]);
    });
    return Response.json({ok:true},{headers});
  }catch(error){const denied=authFailure(error);if(denied)return denied;return Response.json({error:"Could not disconnect Telegram."},{status:500,headers});}
}
