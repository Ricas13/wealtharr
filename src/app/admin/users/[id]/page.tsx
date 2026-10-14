import Link from "next/link";
import {notFound} from "next/navigation";
import {z} from "zod";
import {sql} from "@/lib/db";
import {requireAdminPage} from "@/lib/session";
import {UserStrategyAccessEditor} from "@/components/UserStrategyAccessEditor";
import {AdminStripeSubscriptionVerify} from "@/components/AdminStripeSubscriptionVerify";
import {AdminStripeInvoiceHistory} from "@/components/AdminStripeInvoiceHistory";
import {subscriptionWatchReason} from "@/domain/admin-subscription-watch";

export const dynamic="force-dynamic";

const formatUtc=(value:unknown)=>value?new Date(String(value)).toLocaleString("en-GB",{timeZone:"UTC"})+" UTC":"Not recorded";

/**
 * Every customer page validates Admin access independently of the parent layout.
 * It selects a single non-deleted account and never loads brokerage balances,
 * trade history, payment identifiers, encrypted secrets or raw provider errors.
 */
export default async function AdminCustomerDetail({params}:{params:Promise<{id:string}>}){
 await requireAdminPage();
 const {id}=await params;
 if(!z.string().uuid().safeParse(id).success)notFound();

 const [users,subscriptions,activity,strategies,overrides,changes]=await Promise.all([
  sql.unsafe("SELECT id,email,country,role,created_at FROM users WHERE id=$1::uuid AND deleted_at IS NULL LIMIT 1",[id]),
  sql.unsafe(
   "SELECT p.display_name AS plan,s.status,s.source,s.cadence,s.cancel_at_period_end,s.current_period_end,s.billing_checked_at,"+
   "(s.billing_check_error IS NOT NULL) AS sync_error FROM subscriptions s "+
   "LEFT JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1::uuid LIMIT 1",[id]
  ),
  sql.unsafe(
   "SELECT count(*) FILTER (WHERE status='ACTIVE')::int AS active,"+
   "count(*) FILTER (WHERE status='ACTIVE' AND health_status<>'HEALTHY')::int AS attention "+
   "FROM strategy_instances WHERE user_id=$1::uuid",[id]
  ),
  sql.unsafe("SELECT key,name FROM strategy_definitions ORDER BY name"),
  sql.unsafe(
   "SELECT d.key,a.allowed FROM user_strategy_access a "+
   "JOIN strategy_definitions d ON d.id=a.strategy_definition_id WHERE a.user_id=$1::uuid ORDER BY d.name",
   [id]
  ),
  sql.unsafe(
   "SELECT action,occurred_at FROM audit_events WHERE entity_type='user' AND entity_id=$1 "+
   "AND action='user.strategy-access.changed' ORDER BY occurred_at DESC LIMIT 10",
   [id]
  )
 ]);
 const user=users[0];
 if(!user)notFound();
 const sub=subscriptions[0];
 const status=String(sub?.status??"Unassigned");
 const reason=sub?subscriptionWatchReason({
  status,cancelAtPeriodEnd:sub.cancel_at_period_end===true,
  periodEnd:sub.current_period_end?new Date(sub.current_period_end):null,
  hasBillingCheckError:sub.sync_error===true
 },new Date()):null;
 return <div className="admin-customer-detail">
  <div className="admin-design-heading"><div>
   <span className="admin-kicker">WORKSPACE / CUSTOMERS / ACCOUNT</span>
   <h1>Customer account</h1>
   <p>Manage individual strategy access within existing global, plan and eligibility restrictions.</p>
  </div><Link className="admin-design-button" href="/admin/users">Back to customers</Link></div>

  <section className="admin-design-panel" aria-labelledby="admin-customer-identity-title">
   <header className="admin-design-panel-header"><div>
    <h2 id="admin-customer-identity-title">{String(user.email)}</h2>
    <p>Registered account details; no portfolio values or payment credentials.</p>
   </div></header>
   <div className="admin-design-info-row"><span>Country</span><strong>{String(user.country)}</strong></div>
   <div className="admin-design-info-row"><span>Account role</span><strong>{String(user.role)}</strong></div>
   <div className="admin-design-info-row"><span>Registered</span><strong>{formatUtc(user.created_at)}</strong></div>
   <div className="admin-design-info-row"><span>Active strategy instances</span><strong>{Number(activity[0]?.active??0)}</strong></div>
   <div className="admin-design-info-row"><span>Active strategies needing attention</span><strong>{Number(activity[0]?.attention??0)}</strong></div>
  </section>

  <section className="admin-design-panel" aria-labelledby="admin-customer-billing-title">
   <header className="admin-design-panel-header"><div>
    <h2 id="admin-customer-billing-title">Recorded subscription</h2>
    <p>Internal state only; does not establish that a charge succeeded.</p>
   </div><Link href="/admin/plans" className="admin-panel-footer-link">Commerce</Link></header>
   <div className="admin-design-info-row"><span>Plan</span><strong>{String(sub?.plan??"No subscription")}</strong></div>
   <div className="admin-design-info-row"><span>Status</span><strong>{status}</strong></div>
   <div className="admin-design-info-row"><span>Provider source</span><strong>{String(sub?.source??"Unassigned")}</strong></div>
   <div className="admin-design-info-row"><span>Billing cadence</span><strong>{String(sub?.cadence??"Not recorded")}</strong></div>
   <div className="admin-design-info-row"><span>Period end</span><strong>{formatUtc(sub?.current_period_end)}</strong></div>
   <div className="admin-design-info-row"><span>Scheduled cancellation</span><strong>{sub?(sub.cancel_at_period_end===true?"At period end":"No"):"Not recorded"}</strong></div>
   <div className="admin-design-info-row"><span>Last billing reconciliation check</span><strong>{formatUtc(sub?.billing_checked_at)}</strong></div>
   <div className="admin-design-info-row"><span>Billing reconciliation warning</span><strong>{sub?.sync_error===true?"Recorded — investigate":"None recorded"}</strong></div>
   {reason&&<p className="admin-data-caveat">Review: {reason}. Verify the billing provider before changing account access.</p>}
   <p className="admin-data-caveat">This page does not collect payments, issue refunds, override billing status or expose Stripe IDs.</p>
  </section>

  {String(sub?.source??"") === "STRIPE" && <><AdminStripeSubscriptionVerify userId={String(user.id)}/><AdminStripeInvoiceHistory userId={String(user.id)}/></>}

  <div style={{marginTop:20}}><UserStrategyAccessEditor key={String(user.id)}
   users={[{id:String(user.id),email:String(user.email)}]}
   strategies={strategies.map(r=>({key:String(r.key),name:String(r.name)}))}
   initialOverrides={overrides.map(r=>({userId:String(user.id),key:String(r.key),allowed:r.allowed===true}))}
  /></div>

  <section className="admin-design-panel" style={{marginTop:20}} aria-labelledby="customer-access-audit-title">
   <header className="admin-design-panel-header"><div><h2 id="customer-access-audit-title">Recent access changes</h2>
    <p>Last 10 recorded changes to individual strategy permissions.</p></div></header>
   {changes.length?<div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Recent strategy access audit">
    <table className="admin-studio-table"><thead><tr><th scope="col">ACTION</th><th scope="col">WHEN (UTC)</th></tr></thead>
     <tbody>{changes.map((change,i)=><tr key={i}><td>{String(change.action)}</td><td>{formatUtc(change.occurred_at)}</td></tr>)}</tbody>
    </table></div>:<p className="admin-data-caveat">No individual strategy-access changes recorded.</p>}
   <p className="admin-data-caveat">Access changes are audited. This list does not contain sensitive metadata or portfolio holdings.</p>
  </section>
 </div>;
}
