import Stripe from "stripe";
import {z} from "zod";
import {requireAdmin} from "@/lib/session";
import {assertSameOrigin} from "@/lib/security";
import {getEmailProvider} from "@/lib/email";
import {getMarketDataProvider} from "@/lib/market-data";
import {acceptHistoryObservation} from "@/domain/trusted-history";
import {ensureSettings} from "@/lib/settings";
import {sql} from "@/lib/db";
import { authFailure } from "@/lib/api-auth";
import {telegramCall} from "@/lib/telegram";
import {validTelegramWebhookSecret} from "@/domain/telegram";

const schema=z.discriminatedUnion("service",[
 z.object({service:z.literal("STRIPE")}),
 z.object({service:z.literal("EMAIL")}),
 z.object({service:z.literal("TELEGRAM")}),
 z.object({service:z.literal("MARKET_DATA"),symbol:z.string().regex(/^[A-Za-z0-9._:-]{1,32}$/)}),
 z.object({service:z.literal("MARKET_DATA_HISTORY"),
   symbol:z.string().regex(/^[A-Za-z0-9._:-]{1,32}$/),
   date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
   currency:z.string().regex(/^[A-Z]{3}$/)})
]);
/** Explicit admin-triggered tests; no arbitrary remote URLs or recipient addresses. */
export async function POST(request:Request){
 try{
  assertSameOrigin(request);
  const admin=await requireAdmin();
  const p=schema.parse(await request.json());
  // Credentials saved in Master Admin must take effect even in a cold process.
  await ensureSettings(true);
  let ok=false;
  let message="Connection failed.";
  try{
   if(p.service==="STRIPE"){
    const token=process.env.STRIPE_SECRET_KEY;
    if(!token)throw new Error("STRIPE_NOT_CONFIGURED");
    const balance=await new Stripe(token,{timeout:8000,maxNetworkRetries:0}).balance.retrieve();
    ok=Boolean(balance.object==="balance");
    message=ok?"Stripe authenticated successfully. This does not test billing webhooks.":"Stripe did not return an account.";
   }else if(p.service==="TELEGRAM"){
    const origin=process.env.NEXT_PUBLIC_APP_URL;
    const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
    const username=process.env.TELEGRAM_BOT_USERNAME;
    if(!origin||!origin.startsWith("https://")||!validTelegramWebhookSecret(secret)||!username)throw new Error("TELEGRAM_NOT_CONFIGURED");
    const me=await telegramCall("getMe");
    if(!me.ok||me.username?.toLowerCase()!==username.toLowerCase())throw new Error("TELEGRAM_BOT_USERNAME_MISMATCH");
    const webUrl=new URL("/api/integrations/telegram/webhook",origin);
    const linked=await telegramCall("setWebhook",{url:webUrl.href,secret_token:secret,allowed_updates:["message"],drop_pending_updates:false});
    ok=linked.ok;
    message=ok?"Telegram bot verified and webhook registered successfully. Users can now connect via a one-time link.":"Telegram did not accept its webhook configuration.";
   }else if(p.service==="EMAIL"){
    if(process.env.EMAIL_PROVIDER!=="http"||!process.env.EMAIL_HTTP_ENDPOINT||!process.env.EMAIL_HTTP_TOKEN)throw new Error("EMAIL_NOT_CONFIGURED");
    ok=await getEmailProvider().send({to:admin.email,subject:"9sig admin email delivery test",text:"This is a one-time email connectivity test initiated by an administrator."});
    message=ok?"Provider accepted test email to your admin account; inbox delivery is not guaranteed.":"Email provider rejected test message.";
   }else if(p.service==="MARKET_DATA_HISTORY"){
    const day=new Date(p.date+"T00:00:00Z");
    if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==p.date||
       day.getTime()>=Date.now())throw new Error("INVALID_HISTORY_TEST_DATE");
    const provider=getMarketDataProvider();
    if(!provider.configured||provider.name==="mock")throw new Error("MARKET_DATA_NOT_CONFIGURED");
    const observation=await provider.historicalPrice(p.symbol,new Date(p.date+"T21:00:00Z"));
    ok=acceptHistoryObservation(observation,p.date,p.currency);
    message=ok
      ? "Provider returned the expected daily CLOSE, in the requested currency and on the exact date, marked corporate-action-adjusted. Verify dividends, splits, licensing and full historical coverage separately."
      : "The historical endpoint did not return an exact-day, corporate-action-adjusted daily CLOSE in the requested currency. Momentum research must remain disabled.";
   }else{
    const provider=getMarketDataProvider();
    if(!provider.configured||provider.name==="mock")throw new Error("MARKET_DATA_NOT_CONFIGURED");
    const quote=await provider.currentPrice(p.symbol);
    ok=Boolean(quote&&quote.price&&quote.provider&&quote.currency&&quote.observedAt instanceof Date&&Number.isFinite(quote.observedAt.getTime())&&quote.observedAt.getTime()<=Date.now());
    message=ok?"Received a market observation. This does not prove historical coverage or data licensing.":"No usable quote returned.";
   }
  }catch(error){
    // Provider errors may contain credentials or private URLs; only expose approved codes.
    const code=error instanceof Error?error.message:"";
    const safeMessages=new Map([
      ["STRIPE_NOT_CONFIGURED","Stripe is not configured."],
      ["TELEGRAM_NOT_CONFIGURED","Telegram is not configured."],
      ["TELEGRAM_BOT_USERNAME_MISMATCH","Telegram bot username mismatch."],
      ["EMAIL_NOT_CONFIGURED","Email is not configured."],
      ["INVALID_HISTORY_TEST_DATE","Choose a valid past date."],
      ["MARKET_DATA_NOT_CONFIGURED","Market data is not configured."]
    ]);
    message=safeMessages.get(code)??"Provider test failed. Check the integration settings and availability.";
  }
  await sql.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,metadata) VALUES ($1,'integration.connection-test','integration',$2::jsonb)",[
   admin.id,JSON.stringify({service:p.service,ok,code:ok?"CONNECTED":"TEST_FAILED"})
  ]);
  return Response.json({ok,message},{status:ok?200:503,headers:{"cache-control":"no-store"}});
 }catch(error){const denied=authFailure(error);if(denied)return denied;
  if(error instanceof z.ZodError)return Response.json({error:"Invalid connection test request."},{status:400});
  return Response.json({error:"Connection test unavailable."},{status:500});
 }
}
