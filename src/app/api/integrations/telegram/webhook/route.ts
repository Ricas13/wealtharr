import {sql} from "@/lib/db";
import {encryptSecret} from "@/lib/crypto";
import {ensureSettings} from "@/lib/settings";
import {hashTelegramLinkToken,secureTokenMatch,telegramStartToken} from "@/domain/telegram";
import {telegramCall} from "@/lib/telegram";
import {loadEntitlements} from "@/lib/entitlement-service";

export const dynamic="force-dynamic";
export async function POST(request:Request){
  await ensureSettings();
  const supplied=request.headers.get("x-telegram-bot-api-secret-token");
  if(!secureTokenMatch(supplied,process.env.TELEGRAM_WEBHOOK_SECRET))
    return Response.json({ok:false},{status:401,headers:{"cache-control":"no-store"}});
  const raw=await request.text().catch(()=>"");
  if(raw.length>10_000)return Response.json({ok:false},{status:413});
  let payload:unknown;try{payload=JSON.parse(raw);}catch{return Response.json({ok:true});}
  const parsed=telegramStartToken(payload);
  if(!parsed)return Response.json({ok:true});
  const tokenHash=hashTelegramLinkToken(parsed.token);
  let linked=false;
  try{
    await sql.begin(async tx=>{
      const matches=await tx.unsafe(
        "SELECT t.id,t.user_id FROM telegram_link_tokens t JOIN users u ON u.id=t.user_id "+
        "WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>now() AND u.deleted_at IS NULL FOR UPDATE OF t",
        [tokenHash]
      );
      if(!matches[0])return;
      const allowed=await loadEntitlements(String(matches[0].user_id));
      if(!allowed.notificationChannels.has("TELEGRAM"))return;
      const consumed=await tx.unsafe("UPDATE telegram_link_tokens SET used_at=now() WHERE id=$1 AND used_at IS NULL RETURNING id",[matches[0].id]);
      if(!consumed[0])return;
      await tx.unsafe("INSERT INTO notification_endpoints (user_id,channel,encrypted_destination,enabled) VALUES ($1,'TELEGRAM',$2,true) ON CONFLICT (user_id,channel) DO UPDATE SET encrypted_destination=EXCLUDED.encrypted_destination,enabled=true,updated_at=now()",[matches[0].user_id,encryptSecret(parsed.chatId)]);
      await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type) VALUES ($1,'telegram.connected','notification_endpoint')",[matches[0].user_id]);
      linked=true;
    });
  }catch{return Response.json({ok:false},{status:500});}
  if(linked)await telegramCall("sendMessage",{chat_id:parsed.chatId,text:"Wealtharr is connected. Your scheduled strategy alerts will appear here when your plan includes Telegram."});
  return Response.json({ok:true});
}
