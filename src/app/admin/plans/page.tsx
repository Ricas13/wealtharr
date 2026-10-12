import {sql} from "@/lib/db";
import {requireAdminPage} from "@/lib/session";
import {PlanPriceEditor} from "@/components/AdminEditors";
import {StripePriceSync} from "@/components/StripePriceSync";
import {SimplePlanEditor} from "@/components/SimplePlanEditor";
import {CreditCard,UsersRound,Layers3} from "lucide-react";

export const dynamic="force-dynamic";
export default async function PlansAdmin(){
 await requireAdminPage();
 const [rows,definitions,prices,active]=await Promise.all([
  sql.unsafe("SELECT slug,display_name,monthly_price_minor,annual_price_minor,annual_discount_bps,billing_currency,supported_billing_currencies,max_active_strategies,trial_days,visible,archived,entitlements,description,available_strategy_keys,sort_order,stripe_monthly_price_id,stripe_annual_price_id FROM plans ORDER BY sort_order"),
  sql.unsafe("SELECT key,name,enabled FROM strategy_definitions ORDER BY name"),
  sql.unsafe("SELECT p.slug,pp.currency,pp.cadence,pp.amount_minor,pp.stripe_price_id,pp.apple_product_id,pp.google_product_id,pp.active FROM plan_prices pp JOIN plans p ON p.id=pp.plan_id ORDER BY p.sort_order,pp.currency,pp.cadence"),
  sql.unsafe("SELECT count(*)::int AS c FROM subscriptions WHERE status IN ('ACTIVE','TRIALING')")
 ]);
 const summary=[
  {label:"Published plans",count:rows.filter(p=>p.visible&&!p.archived).length,Icon:Layers3,detail:"Visible and not archived"},
  {label:"Active or trial subscriptions",count:Number(active[0]?.c??0),Icon:UsersRound,detail:"Does not represent paid revenue"},
  {label:"Active price options",count:prices.filter(p=>p.active).length,Icon:CreditCard,detail:"Across supported billing currencies"}
 ];
 return <div className="admin-commerce-page">
  <div className="admin-design-heading"><div><span className="admin-kicker">WORKSPACE / COMMERCE</span><h1>Commerce</h1>
   <p>Configure plans, entitlements, currencies and audited Stripe pricing.</p></div></div>
  <div className="admin-overview-kpis admin-three-kpis">{summary.map(({label,count,detail,Icon})=>
    <div className="admin-design-kpi" key={label}><span className="admin-design-kpi-title">{label}<Icon size={17}/></span>
     <strong>{count}</strong><span className="admin-design-kpi-detail">{detail}</span></div>)}</div>
  <section className="admin-design-panel">
   <header className="admin-design-panel-header"><div><h2>Plans & entitlements</h2>
    <p>Default billing amounts and strategy access, sourced from current plan records.</p></div></header>
   <div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Subscription plans">
   <table className="admin-studio-table"><thead><tr><th scope="col">PLAN</th><th scope="col">MONTHLY</th><th scope="col">ANNUAL</th><th scope="col">STRATEGIES</th><th scope="col">VISIBILITY</th></tr></thead>
    <tbody>{rows.map(p=><tr key={String(p.slug)}>
      <td><strong>{String(p.display_name)}</strong><small>{String(p.description??"")}</small></td>
      <td>{String(p.billing_currency)} {(Number(p.monthly_price_minor)/100).toFixed(2)}</td>
      <td>{String(p.billing_currency)} {(Number(p.annual_price_minor)/100).toFixed(2)}<small>{(Number(p.annual_discount_bps)/100).toFixed(2)}% configured discount</small></td>
      <td>{p.max_active_strategies??"Unlimited"}</td>
      <td>{p.visible&&!p.archived?<span className="admin-studio-release-state is-live">Visible</span>:<span className="admin-studio-release-state is-review">Hidden</span>}</td>
    </tr>)}</tbody></table></div>
  </section>
  <section className="admin-design-panel admin-commerce-prices">
   <header className="admin-design-panel-header"><div><h2>Price catalogue</h2>
    <p>Recorded Stripe, Apple and Google product identifiers. Setting a price does not confirm a live payment.</p></div></header>
   <div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Subscription prices">
   <table className="admin-studio-table"><thead><tr><th>PLAN</th><th>CURRENCY</th><th>CADENCE</th><th>AMOUNT</th><th>PROVIDER PRICE</th><th>APPS</th><th>SETUP</th></tr></thead>
    <tbody>{prices.map(p=><tr key={String(p.slug)+String(p.currency)+String(p.cadence)}>
     <td><strong>{String(p.slug)}</strong><small>{p.active?"Active":"Inactive"}</small></td>
     <td>{String(p.currency)}</td><td>{String(p.cadence)}</td><td>{(Number(p.amount_minor)/100).toFixed(2)}</td>
     <td>{String(p.stripe_price_id??"Not configured")}</td>
     <td><small>Apple: {String(p.apple_product_id??"—")}</small><small>Google: {String(p.google_product_id??"—")}</small></td>
     <td><StripePriceSync slug={String(p.slug)} currency={String(p.currency)} cadence={String(p.cadence)} active={Boolean(p.active)} amountMinor={Number(p.amount_minor)}/></td>
    </tr>)}</tbody></table></div>
  </section>
  <details className="admin-advanced-workflow admin-commerce-editor">
   <summary><span><strong>Edit plans, limits & entitlements</strong><small>Manage strategy availability, pricing and billing product identifiers</small></span><span aria-hidden="true">⌄</span></summary>
   <div className="admin-advanced-content">
    <SimplePlanEditor initialPlans={rows.map(p=>({
     slug:String(p.slug),displayName:String(p.display_name),description:String(p.description??""),
     monthlyPriceMinor:Number(p.monthly_price_minor),annualPriceMinor:Number(p.annual_price_minor),
     annualDiscountBps:Number(p.annual_discount_bps),currency:String(p.billing_currency),
     supportedBillingCurrencies:Array.isArray(p.supported_billing_currencies)?p.supported_billing_currencies.map(String):["GBP"],
     maxActiveStrategies:p.max_active_strategies==null?null:Number(p.max_active_strategies),
     availableStrategyKeys:Array.isArray(p.available_strategy_keys)?p.available_strategy_keys.map(String):[],
     stripeMonthlyPriceId:p.stripe_monthly_price_id??null,stripeAnnualPriceId:p.stripe_annual_price_id??null,
     entitlements:p.entitlements??{},trialDays:Number(p.trial_days),visible:Boolean(p.visible),archived:Boolean(p.archived),sortOrder:Number(p.sort_order)
    }))} strategies={definitions.map(d=>({key:String(d.key),name:String(d.name),enabled:Boolean(d.enabled)}))}/>
    <PlanPriceEditor/>
   </div>
  </details>
  <p className="admin-data-caveat">Recurring revenue remains unreported until reconciled payment data and refunds are available. Plan prices and subscription counts are not recognised revenue.</p>
 </div>;
}
