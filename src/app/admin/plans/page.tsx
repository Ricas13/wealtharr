import Link from "next/link";
import {sql} from "@/lib/db";
import {requireAdminPage} from "@/lib/session";
import {PlanPriceEditor} from "@/components/AdminEditors";
import {StripePriceSync} from "@/components/StripePriceSync";
import {SimplePlanEditor} from "@/components/SimplePlanEditor";
import {CreditCard,UsersRound,Layers3} from "lucide-react";
import {subscriptionWatchReason} from "@/domain/admin-subscription-watch";

export const dynamic="force-dynamic";
export default async function PlansAdmin(){
 await requireAdminPage();
 const [rows,definitions,prices,active,lifecycle,webhookFailures,webhookStates,watchSummary,watchRows]=await Promise.all([
  sql.unsafe("SELECT slug,display_name,monthly_price_minor,annual_price_minor,annual_discount_bps,billing_currency,supported_billing_currencies,max_active_strategies,trial_days,visible,archived,entitlements,description,homepage_highlights,available_strategy_keys,sort_order,stripe_monthly_price_id,stripe_annual_price_id FROM plans ORDER BY sort_order"),
  sql.unsafe("SELECT key,name,enabled FROM strategy_definitions ORDER BY name"),
  sql.unsafe("SELECT p.slug,pp.currency,pp.cadence,pp.amount_minor,pp.stripe_price_id,pp.apple_product_id,pp.google_product_id,pp.active FROM plan_prices pp JOIN plans p ON p.id=pp.plan_id ORDER BY p.sort_order,pp.currency,pp.cadence"),
  sql.unsafe("SELECT count(*)::int AS c FROM subscriptions WHERE status IN ('ACTIVE','TRIALING')"),
  sql.unsafe("SELECT status,count(*)::int AS c FROM subscriptions GROUP BY status ORDER BY status"),
  sql.unsafe("SELECT count(*)::int AS c FROM billing_webhook_events WHERE status='FAILED' AND created_at>=now()-interval '24 hours'"),
  sql.unsafe("SELECT status,count(*)::int AS c,max(created_at) AS last_received FROM billing_webhook_events WHERE created_at>=now()-interval '24 hours' GROUP BY status ORDER BY status"),
  sql.unsafe("SELECT count(*) FILTER (WHERE s.status IN ('ACTIVE','TRIALING') AND s.cancel_at_period_end=true)::int AS ending, count(*) FILTER (WHERE s.status IN ('ACTIVE','TRIALING') AND s.current_period_end<now())::int AS overdue, count(*) FILTER (WHERE s.status IN ('PAST_DUE','UNPAID'))::int AS payment_attention, count(*) FILTER (WHERE s.status IN ('ACTIVE','TRIALING','PAST_DUE','UNPAID') AND s.billing_check_error IS NOT NULL)::int AS sync_errors, count(*) FILTER (WHERE s.status IN ('ACTIVE','TRIALING') AND s.cancel_at_period_end=false AND s.current_period_end>=now() AND s.current_period_end<now()+interval '7 days')::int AS approaching FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE u.deleted_at IS NULL"),
  sql.unsafe("SELECT u.id AS user_id,u.email,p.display_name AS plan,s.status,s.source,s.cancel_at_period_end,s.current_period_end,(s.billing_check_error IS NOT NULL) AS sync_error FROM subscriptions s JOIN users u ON u.id=s.user_id JOIN plans p ON p.id=s.plan_id WHERE u.deleted_at IS NULL AND (s.status IN ('PAST_DUE','UNPAID') OR (s.status IN ('ACTIVE','TRIALING') AND (s.billing_check_error IS NOT NULL OR s.cancel_at_period_end=true OR s.current_period_end<now()))) ORDER BY CASE WHEN s.billing_check_error IS NOT NULL THEN 0 WHEN s.status IN ('PAST_DUE','UNPAID') THEN 1 WHEN s.current_period_end<now() THEN 2 ELSE 3 END,s.current_period_end ASC NULLS LAST LIMIT 50")
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
  <section className="admin-design-panel" aria-labelledby="commerce-lifecycle-title">
   <header className="admin-design-panel-header"><div><h2 id="commerce-lifecycle-title">Subscription lifecycle</h2>
    <p>Recorded subscription states, not recognised revenue or verified payment receipts.</p></div></header>
   {lifecycle.length?<div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Subscription status counts">
    <table className="admin-studio-table"><thead><tr><th scope="col">STATUS</th><th scope="col">SUBSCRIPTIONS</th></tr></thead>
    <tbody>{lifecycle.map(s=><tr key={String(s.status)}><td><strong>{String(s.status)}</strong></td><td>{Number(s.c)}</td></tr>)}</tbody></table></div>:
    <p className="admin-data-caveat">No subscription records yet.</p>}
   <div className="admin-design-info-row"><span>Failed Stripe webhook events (last 24 hours)</span><strong>{Number(webhookFailures[0]?.c??0)}</strong></div>
   <h3>Stripe event processing · last 24 hours</h3>
   {webhookStates.length?<div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Stripe webhook processing status">
    <table className="admin-studio-table"><thead><tr><th scope="col">STATUS</th><th scope="col">EVENTS</th><th scope="col">LATEST RECEIVED</th></tr></thead>
    <tbody>{webhookStates.map(s=><tr key={String(s.status)}><td><strong>{String(s.status)}</strong></td><td>{Number(s.c)}</td><td>{s.last_received?new Date(s.last_received).toLocaleString("en-GB",{timeZone:"UTC"})+" UTC":"—"}</td></tr>)}</tbody></table></div>:
    <p className="admin-data-caveat">No Stripe webhook events recorded in the last 24 hours. This does not prove webhook delivery is working.</p>}
   <p className="admin-data-caveat">A failed webhook may mean a plan change was not applied. Check Operations for recorded failures and use Stripe for payment verification.</p>
   <a href="/admin/operations" className="admin-panel-footer-link">Inspect billing delivery and operational alerts →</a>
  </section>
  <section className="admin-design-panel" aria-labelledby="commerce-subscription-watch">
   <header className="admin-design-panel-header"><div><h2 id="commerce-subscription-watch">Subscription watch</h2>
    <p>Recorded billing periods, scheduled cancellations and accounts requiring reconciliation; no subscription changes are performed here.</p></div></header>
   <div className="admin-design-info-row"><span>Scheduled to end at period close</span><strong>{Number(watchSummary[0]?.ending??0)}</strong></div>
   <div className="admin-design-info-row"><span>Active or trial periods with a past recorded end</span><strong>{Number(watchSummary[0]?.overdue??0)}</strong></div>
   <div className="admin-design-info-row"><span>Past-due or unpaid subscription status</span><strong>{Number(watchSummary[0]?.payment_attention??0)}</strong></div>
   <div className="admin-design-info-row"><span>Billing reconciliation errors recorded</span><strong>{Number(watchSummary[0]?.sync_errors??0)}</strong></div>
   <div className="admin-design-info-row"><span>Non-cancelling billing periods ending within 7 days</span><strong>{Number(watchSummary[0]?.approaching??0)}</strong></div>
   <p className="admin-data-caveat">Counts can overlap. A recorded period ending is not evidence that renewal or collection failed; check the payment provider before changing customer access.</p>
   <h3>Customer records needing review</h3>
   {watchRows.length?<div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Subscriptions requiring operator review">
    <table className="admin-studio-table"><thead><tr><th scope="col">CUSTOMER</th><th scope="col">PLAN / SOURCE</th><th scope="col">STATUS</th><th scope="col">RECORDED PERIOD END (UTC)</th><th scope="col">REVIEW REASON</th></tr></thead>
    <tbody>{watchRows.map((s,i)=><tr key={i}><td><strong><Link href={"/admin/users/"+String(s.user_id)} aria-label={"Review customer "+String(s.email)}>{String(s.email)}</Link></strong></td>
     <td>{String(s.plan)}<small>{String(s.source??"Unknown source")}</small></td>
     <td>{String(s.status)}</td>
     <td>{s.current_period_end?new Date(s.current_period_end).toLocaleString("en-GB",{timeZone:"UTC"})+" UTC":"Not recorded"}</td>
     <td>{subscriptionWatchReason({status:String(s.status),cancelAtPeriodEnd:s.cancel_at_period_end===true,periodEnd:s.current_period_end?new Date(s.current_period_end):null,hasBillingCheckError:s.sync_error===true},new Date())??"Review"}</td>
    </tr>)}</tbody></table></div>:
    <p className="admin-data-caveat">No subscriptions currently meet these review conditions. Provider reconciliation has not been independently verified.</p>}
   <p className="admin-data-caveat">Shows up to 50 records requiring attention. Raw billing errors, customer payment credentials and investment holdings are never selected.</p>
   <Link href="/admin/users" className="admin-panel-footer-link">Open customer directory →</Link>
  </section>
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
     homepageHighlights:Array.isArray(p.homepage_highlights)?p.homepage_highlights.map(String):[],
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
