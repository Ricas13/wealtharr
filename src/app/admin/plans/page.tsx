import { sql } from "@/lib/db";
import { PlanPriceEditor } from "@/components/AdminEditors";
import { StripePriceSync } from "@/components/StripePriceSync";
import { SimplePlanEditor } from "@/components/SimplePlanEditor";

export default async function PlansAdmin() {
 const rows=await sql.unsafe(
  "SELECT slug,display_name,monthly_price_minor,annual_price_minor,annual_discount_bps,billing_currency,"+
  "supported_billing_currencies,max_active_strategies,trial_days,visible,archived,entitlements,"+
  "description,available_strategy_keys,sort_order,stripe_monthly_price_id,stripe_annual_price_id,"+
  "marketing,payment_methods FROM plans ORDER BY sort_order,slug"
 );
 const definitions=await sql.unsafe("SELECT key,name,enabled FROM strategy_definitions ORDER BY name");
 const prices=await sql.unsafe(
  "SELECT p.slug,pp.currency,pp.cadence,pp.amount_minor,pp.stripe_price_id,pp.paypal_plan_id,"+
  "pp.apple_product_id,pp.google_product_id,pp.active FROM plan_prices pp "+
  "JOIN plans p ON p.id=pp.plan_id ORDER BY p.sort_order,pp.currency,pp.cadence"
 );
 function stringArray(value:unknown) {
  if(Array.isArray(value))return value.map(String);
  if(typeof value==="string"){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.map(String):[];}catch{return [];}}
  return [];
 }
 function objectValue(value:unknown):Record<string,unknown>{
  if(typeof value==="string"){try{return objectValue(JSON.parse(value));}catch{return {};}}
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
 }
 return <div className="stack">
  <div className="page-title"><div><div className="eyebrow">Master Admin · Plans</div><h1>Plans &amp; pricing</h1>
    <p>Publish up to five pricing cards, set real entitlements, and keep the marketing text independent of billing access.</p></div></div>
  <div className="detail-grid">
   <SimplePlanEditor initialPlans={rows.map((p:any)=>{
     const marketing=objectValue(p.marketing);
     const entitlements=objectValue(p.entitlements);
     return {
      slug:String(p.slug),displayName:String(p.display_name),description:String(p.description??""),
      monthlyPriceMinor:Number(p.monthly_price_minor),annualPriceMinor:Number(p.annual_price_minor),
      annualDiscountBps:Number(p.annual_discount_bps),currency:String(p.billing_currency),
      supportedBillingCurrencies:stringArray(p.supported_billing_currencies),
      maxActiveStrategies:p.max_active_strategies==null?null:Number(p.max_active_strategies),
      availableStrategyKeys:stringArray(p.available_strategy_keys),
      stripeMonthlyPriceId:p.stripe_monthly_price_id??null,stripeAnnualPriceId:p.stripe_annual_price_id??null,
      entitlements:{features:stringArray(entitlements.features),notificationChannels:stringArray(entitlements.notificationChannels)},
      trialDays:Number(p.trial_days),visible:Boolean(p.visible),archived:Boolean(p.archived),sortOrder:Number(p.sort_order),
      marketing:{title:String(marketing.title??p.display_name),subtitle:String(marketing.subtitle??p.description??""),
        badge:String(marketing.badge??""),cta:String(marketing.cta??"Choose "+p.display_name),
        benefits:stringArray(marketing.benefits),featured:Boolean(marketing.featured)},
      paymentMethods:stringArray(p.payment_methods)
     };
   })} strategies={definitions.map((d:any)=>({key:String(d.key),name:String(d.name),enabled:Boolean(d.enabled)}))}/>
   <div className="stack">
    <section className="card"><h3>Provider readiness</h3><p className="help">
      Stripe is supported by the current payment workflow. PayPal plan references can be staged, but PayPal
      checkout and webhooks are not yet integrated; the public website will never treat them as connected.
      Live payments remain subject to existing launch checks.
    </p></section>
    <PlanPriceEditor/>
   </div>
  </div>
  <div className="table-wrap" tabIndex={0} role="region" aria-label="Configured plan prices"><table>
   <thead><tr><th>Plan</th><th>Currency</th><th>Term</th><th>Price</th><th>Stripe</th><th>PayPal (staged)</th><th>Active</th><th>Sync Stripe</th></tr></thead>
   <tbody>{prices.map((p:any)=><tr key={p.slug+p.currency+p.cadence}>
    <td>{p.slug}</td><td>{p.currency}</td><td>{p.cadence}</td><td>{(Number(p.amount_minor)/100).toFixed(2)}</td>
    <td>{p.stripe_price_id??"Not configured"}</td><td>{p.paypal_plan_id??"Not configured"}</td>
    <td>{p.active?"Yes":"No"}</td><td><StripePriceSync slug={String(p.slug)} currency={String(p.currency)} cadence={String(p.cadence)}
      active={Boolean(p.active)} amountMinor={Number(p.amount_minor)}/></td>
   </tr>)}</tbody>
  </table></div>
 </div>;
}