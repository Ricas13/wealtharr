import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { enforceStrategyEntitlements } from "@/lib/entitlement-service";
import { authFailure } from "@/lib/api-auth";

const schema=z.object({
  slug:z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),displayName:z.string().min(1),description:z.string().default(""),
  monthlyPriceMinor:z.number().int().nonnegative(),annualPriceMinor:z.number().int().nonnegative(),
  annualDiscountBps:z.number().int().min(0).max(10000).default(0),
  currency:z.string().length(3),supportedBillingCurrencies:z.array(z.string().length(3)).min(1),
  maxActiveStrategies:z.number().int().positive().nullable(),availableStrategyKeys:z.array(z.string()).default([]),
  stripeMonthlyPriceId:z.string().nullable().optional(),stripeAnnualPriceId:z.string().nullable().optional(),
  entitlements:z.object({features:z.array(z.enum(["history","reconciliation","resume","community","analytics","comparisons","what_if","advanced_imports","multi_account"])).default([]),notificationChannels:z.array(z.enum(["EMAIL","DISCORD","TELEGRAM"])).default([])}).strict(),trialDays:z.number().int().nonnegative().default(0),
  visible:z.boolean().default(true),archived:z.boolean().default(false),sortOrder:z.number().int().default(0)
});
export async function PUT(request:Request){
  try{assertSameOrigin(request);const admin=await requireAdmin();const p=schema.parse(await request.json());
    await sql.unsafe(
      "INSERT INTO plans (slug,display_name,description,monthly_price_minor,annual_price_minor,annual_discount_bps,billing_currency,supported_billing_currencies,max_active_strategies,available_strategy_keys,stripe_monthly_price_id,stripe_annual_price_id,entitlements,trial_days,visible,archived,sort_order)" +
      " VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16,$17)" +
      " ON CONFLICT (slug) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,monthly_price_minor=EXCLUDED.monthly_price_minor,annual_price_minor=EXCLUDED.annual_price_minor,annual_discount_bps=EXCLUDED.annual_discount_bps,billing_currency=EXCLUDED.billing_currency,supported_billing_currencies=EXCLUDED.supported_billing_currencies,max_active_strategies=EXCLUDED.max_active_strategies,available_strategy_keys=EXCLUDED.available_strategy_keys,stripe_monthly_price_id=EXCLUDED.stripe_monthly_price_id,stripe_annual_price_id=EXCLUDED.stripe_annual_price_id,entitlements=EXCLUDED.entitlements,trial_days=EXCLUDED.trial_days,visible=EXCLUDED.visible,archived=EXCLUDED.archived,sort_order=EXCLUDED.sort_order,updated_at=now()",
      [p.slug,p.displayName,p.description,p.monthlyPriceMinor,p.annualPriceMinor,p.annualDiscountBps,p.currency.toUpperCase(),JSON.stringify(p.supportedBillingCurrencies.map(x=>x.toUpperCase())),p.maxActiveStrategies,JSON.stringify(p.availableStrategyKeys),p.stripeMonthlyPriceId??null,p.stripeAnnualPriceId??null,JSON.stringify(p.entitlements),p.trialDays,p.visible,p.archived,p.sortOrder]
    );
    // Record the change before enforcement so it is audited even if enforcement is slow or fails.
    await sql.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id) VALUES ($1,'plan.upsert','plan',$2)",[admin.id,p.slug]);
    // Limits changed under existing subscribers must apply to them too. Users whose
    // subscription is not live fall back to the free plan, so they are covered by its slug.
    const subscribers=await sql.unsafe(
      "SELECT s.user_id FROM subscriptions s JOIN plans p ON p.id=s.plan_id "+
      "WHERE (p.slug=$1 AND s.status IN ('FREE','ACTIVE','TRIALING','PAST_DUE')) "+
      "OR ($1='free' AND s.status NOT IN ('FREE','ACTIVE','TRIALING','PAST_DUE'))",
      [p.slug]
    );
    let paused=0;
    let enforcementFailures=0;
    for(const subscriber of subscribers){
      try{paused+=(await enforceStrategyEntitlements(String(subscriber.user_id))).paused;}
      catch{enforcementFailures+=1;}
    }
    await sql.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'plan.enforced','plan',$2,$3::jsonb)",[admin.id,p.slug,JSON.stringify({subscribersChecked:subscribers.length,strategiesPaused:paused,enforcementFailures})]);
    return Response.json({ok:true,subscribersChecked:subscribers.length,strategiesPaused:paused,enforcementFailures});
  }catch(error){const denied=authFailure(error);if(denied)return denied;if(error instanceof z.ZodError)return Response.json({error:"Invalid plan configuration."},{status:400});return Response.json({error:"Could not update plan."},{status:500});}
}
