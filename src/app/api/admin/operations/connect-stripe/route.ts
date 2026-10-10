import Stripe from "stripe";
import {requireAdmin} from "@/lib/session";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {saveSettings,ensureSettings} from "@/lib/settings";
import {sql} from "@/lib/db";
import {authFailure} from "@/lib/api-auth";

export const dynamic="force-dynamic";
const privateHeaders={"cache-control":"private, no-store"};
const SUBSCRIPTION_EVENTS=[
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed"
] as const;

/** No arbitrary webhook address from the browser. Uses only the validated public origin. */
export async function POST(request:Request){
 try{
  assertSameOrigin(request);
  const admin=await requireAdmin();
  await consumeRateLimit("admin-stripe-setup:"+admin.id,3,60*60);
  // Admin-stored encrypted credentials are authoritative over deployment defaults.
  await ensureSettings(true);
  const key=process.env.STRIPE_SECRET_KEY;
  const appUrl=process.env.NEXT_PUBLIC_APP_URL;
  if(!key||!/^((sk|rk)_(test|live)_)/.test(key)||!appUrl)
    return Response.json({error:"Save a valid Stripe secret key and public URL in Master Admin first."},{status:409,headers:privateHeaders});
  let target:URL;
  try{
   const origin=new URL(appUrl);
   if(origin.protocol!=="https:"||origin.username||origin.password)throw new Error("NOT_HTTPS");
   target=new URL("/api/stripe/webhook",origin.origin);
  }catch{return Response.json({error:"The public application URL must be HTTPS."},{status:400,headers:privateHeaders});}
  const stripe=new Stripe(key,{timeout:10000,maxNetworkRetries:0});
  let created:string|null=null;
  let secretSaved=false;
  try{
   const existing=await stripe.webhookEndpoints.list({limit:100});
   if(existing.has_more)
     return Response.json({error:"Too many existing Stripe endpoints to safely determine uniqueness. Review in Stripe before proceeding."},{status:409,headers:privateHeaders});
   if(existing.data.some(endpoint=>endpoint.url===target.href))
     return Response.json({error:"A Stripe webhook already exists at this address. Enter its signing secret in Master Admin or rotate it in Stripe; an existing secret cannot be read back."},{status:409,headers:privateHeaders});
   const endpoint=await stripe.webhookEndpoints.create({
     url:target.href,
     enabled_events:[...SUBSCRIPTION_EVENTS]
   });
   created=endpoint.id;
   const secret=(endpoint as Stripe.WebhookEndpoint & {secret?:string}).secret;
   if(!secret||!secret.startsWith("whsec_"))throw new Error("MISSING_STRIPE_WEBHOOK_SECRET");
   const stored=await saveSettings(admin.id,[{key:"STRIPE_WEBHOOK_SECRET",value:secret}]);
   if(!stored.ok)throw new Error("CANNOT_SAVE_STRIPE_SECRET");
   secretSaved=true;
   await sql.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'integration.stripe-webhook-connected','stripe_endpoint',$2,$3::jsonb)",[admin.id,endpoint.id,JSON.stringify({urlPath:target.pathname,subscriptionEventCount:SUBSCRIPTION_EVENTS.length})]).catch(()=>{});
   return Response.json({ok:true,endpointId:endpoint.id},{headers:privateHeaders});
  }catch{
   // If the signing secret could not be persisted, avoid leaving an unusable remote endpoint.
   if(created&&!secretSaved){try{await stripe.webhookEndpoints.del(created);}catch{/* Operator can find orphan by URL */}}
   return Response.json({error:"Stripe webhook registration failed. Check API key permissions and the endpoint list in Stripe."},{status:503,headers:privateHeaders});
  }
 }catch(error){
  const denied=authFailure(error);if(denied)return denied;
  if(error instanceof Error&&error.message==="RATE_LIMITED")return Response.json({error:"Too many setup attempts."},{status:429,headers:privateHeaders});
  return Response.json({error:"Could not configure Stripe."},{status:500,headers:privateHeaders});
 }
}
