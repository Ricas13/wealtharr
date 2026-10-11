import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { enforceStrategyEntitlements } from "@/lib/entitlement-service";
import { authFailure } from "@/lib/api-auth";

const marketing=z.object({
 title:z.string().max(70).default(""),
 subtitle:z.string().max(280).default(""),
 badge:z.string().max(40).default(""),
 cta:z.string().max(70).default("Choose plan"),
 benefits:z.array(z.string().min(1).max(150)).max(8).default([]),
 featured:z.boolean().default(false)
}).strict();
const schema=z.object({
 slug:z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),
 displayName:z.string().trim().min(1).max(70),
 description:z.string().max(500).default(""),
 monthlyPriceMinor:z.number().int().nonnegative(),
 annualPriceMinor:z.number().int().nonnegative(),
 annualDiscountBps:z.number().int().min(0).max(10000).default(0),
 currency:z.string().length(3),
 supportedBillingCurrencies:z.array(z.string().length(3)).min(1),
 maxActiveStrategies:z.number().int().positive().nullable(),
 availableStrategyKeys:z.array(z.string()).default([]),
 stripeMonthlyPriceId:z.string().nullable().optional(),
 stripeAnnualPriceId:z.string().nullable().optional(),
 entitlements:z.object({
  features:z.array(z.enum(["history","reconciliation","resume","community","analytics","comparisons","what_if","advanced_imports","multi_account"])).default([]),
  notificationChannels:z.array(z.enum(["EMAIL","DISCORD","TELEGRAM"])).default([])
 }).strict(),
 trialDays:z.number().int().nonnegative().max(365).default(0),
 visible:z.boolean().default(false),archived:z.boolean().default(false),
 sortOrder:z.number().int().default(0),
 marketing:marketing.default({}),
 paymentMethods:z.array(z.enum(["STRIPE","PAYPAL"])).max(2).default(["STRIPE"])
});
export async function PUT(request:Request) {
 try {
  assertSameOrigin(request);
  const admin=await requireAdmin();
  const p=schema.parse(await request.json());
  if(p.slug==="free" && p.archived) return Response.json({error:"The internal free-access plan cannot be archived."},{status:409});
  if(p.visible&&p.archived) return Response.json({error:"An archived plan cannot be published."},{status:400});
  if(new Set(p.paymentMethods).size!==p.paymentMethods.length)
   return Response.json({error:"Duplicate payment methods are not permitted."},{status:400});
  const currency=p.currency.toUpperCase();
  const currencies=[...new Set(p.supportedBillingCurrencies.map(x=>x.toUpperCase()))];
  if(!currencies.includes(currency)) return Response.json({error:"Default currency must be among supported currencies."},{status:400});
  const result=await sql.begin(async tx=>{
   // Serialize additions and publication to enforce limits even for concurrent administrators.
   await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext('wealtharr-plan-publication'))");
   const existing=await tx.unsafe("SELECT slug FROM plans WHERE slug=$1 FOR UPDATE",[p.slug]);
   const count=await tx.unsafe(
    "SELECT count(*)::int AS n FROM plans WHERE slug<>'free' AND archived=false AND slug<>$1",[p.slug]
   );
   if(!p.archived&&p.slug!=="free"&&Number(count[0]?.n??0)>=5)
    return {error:"At most five active custom plans are permitted.",status:409};
   const published=await tx.unsafe(
    "SELECT count(*)::int AS n FROM plans WHERE visible=true AND archived=false AND slug<>$1",[p.slug]
   );
   if(p.visible&&Number(published[0]?.n??0)>=5)
    return {error:"At most five public plans can be published.",status:409};
   await tx.unsafe(
    "INSERT INTO plans (slug,display_name,description,monthly_price_minor,annual_price_minor,annual_discount_bps,"+
    "billing_currency,supported_billing_currencies,max_active_strategies,available_strategy_keys,"+
    "stripe_monthly_price_id,stripe_annual_price_id,entitlements,trial_days,visible,archived,sort_order,"+
    "marketing,payment_methods) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13::jsonb,"+
    "$14,$15,$16,$17,$18::jsonb,$19::jsonb) ON CONFLICT (slug) DO UPDATE SET "+
    "display_name=EXCLUDED.display_name,description=EXCLUDED.description,"+
    "monthly_price_minor=EXCLUDED.monthly_price_minor,annual_price_minor=EXCLUDED.annual_price_minor,"+
    "annual_discount_bps=EXCLUDED.annual_discount_bps,billing_currency=EXCLUDED.billing_currency,"+
    "supported_billing_currencies=EXCLUDED.supported_billing_currencies,"+
    "max_active_strategies=EXCLUDED.max_active_strategies,available_strategy_keys=EXCLUDED.available_strategy_keys,"+
    "stripe_monthly_price_id=EXCLUDED.stripe_monthly_price_id,stripe_annual_price_id=EXCLUDED.stripe_annual_price_id,"+
    "entitlements=EXCLUDED.entitlements,trial_days=EXCLUDED.trial_days,visible=EXCLUDED.visible,"+
    "archived=EXCLUDED.archived,sort_order=EXCLUDED.sort_order,"+
    "marketing=EXCLUDED.marketing,payment_methods=EXCLUDED.payment_methods,updated_at=now()",
    [p.slug,p.displayName,p.description,p.monthlyPriceMinor,p.annualPriceMinor,p.annualDiscountBps,
      currency,JSON.stringify(currencies),p.maxActiveStrategies,JSON.stringify(p.availableStrategyKeys),
      p.stripeMonthlyPriceId??null,p.stripeAnnualPriceId??null,JSON.stringify(p.entitlements),
      p.trialDays,p.visible,p.archived,p.sortOrder,JSON.stringify(p.marketing),
      JSON.stringify(p.paymentMethods)]
   );
   await tx.unsafe(
    "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,'plan',$3,$4::jsonb)",
    [admin.id,existing.length?"plan.updated":"plan.created",p.slug,
      JSON.stringify({visible:p.visible,archived:p.archived,paymentMethods:p.paymentMethods,
       marketingChanged:true,featureCount:p.entitlements.features.length})]
   );
   return {ok:true};
  });
  if("error" in result) return Response.json({error:result.error},{status:result.status});
  const subscribers=await sql.unsafe(
   "SELECT s.user_id FROM subscriptions s JOIN plans p ON p.id=s.plan_id "+
   "WHERE (p.slug=$1 AND s.status IN ('FREE','ACTIVE','TRIALING','PAST_DUE')) "+
   "OR ($1='free' AND s.status NOT IN ('FREE','ACTIVE','TRIALING','PAST_DUE'))",
   [p.slug]
  );
  let strategiesPaused=0,enforcementFailures=0;
  for(const subscriber of subscribers) {
   try {strategiesPaused+=(await enforceStrategyEntitlements(String(subscriber.user_id))).paused;}
   catch {enforcementFailures++;}
  }
  await sql.unsafe(
   "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'plan.enforced','plan',$2,$3::jsonb)",
   [admin.id,p.slug,JSON.stringify({subscribersChecked:subscribers.length,strategiesPaused,enforcementFailures})]
  );
  return Response.json({ok:true,subscribersChecked:subscribers.length,strategiesPaused,enforcementFailures});
 } catch (error) {
  const denied=authFailure(error);if(denied)return denied;
  if(error instanceof z.ZodError)return Response.json({error:"Invalid plan configuration."},{status:400});
  return Response.json({error:"Could not update plan."},{status:500});
 }
}