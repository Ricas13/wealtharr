import Link from "next/link";
import {requireAdminPage} from "@/lib/session";
import {ArrowRight,UsersRound,Layers3,Wallet,TriangleAlert,CheckCircle2,ShieldAlert,PlugZap,ArrowUpRight} from "lucide-react";
import {sql} from "@/lib/db";
import {FeatureFlagEditor} from "@/components/AdminEditors";
import {gatherSnapshot} from "@/lib/ops-monitor";
import {evaluateOps} from "@/domain/ops-health";
import {AdminGrowthChart} from "@/components/AdminGrowthChart";

export const dynamic="force-dynamic";

export default async function AdminPage(){
 await requireAdminPage();
 const [users,strategies,failed,attention,runs,flags,definitions,attested,registrations,createdStrategies,customers30,activeSubscriptions,billingFailures]=await Promise.all([
  sql.unsafe("SELECT count(*)::int AS c FROM users WHERE deleted_at IS NULL"),
  sql.unsafe("SELECT count(*)::int AS c FROM strategy_instances WHERE status='ACTIVE'"),
  sql.unsafe("SELECT count(*)::int AS c FROM notification_deliveries WHERE status='PENDING' AND attempt_count>2"),
  sql.unsafe("SELECT count(*)::int AS c FROM strategy_instances WHERE health_status<>'HEALTHY' AND status='ACTIVE'"),
  sql.unsafe("SELECT DISTINCT ON (worker_key) worker_key,status,started_at,finished_at FROM worker_runs ORDER BY worker_key,started_at DESC"),
  sql.unsafe("SELECT key,enabled,updated_at FROM feature_flags ORDER BY key"),
  sql.unsafe("SELECT count(*)::int AS total,count(*) FILTER (WHERE enabled=true)::int AS enabled FROM strategy_definitions"),
  sql.unsafe("SELECT count(*)::int AS c FROM strategy_version_attestations"),
  sql.unsafe("SELECT to_char(date_trunc('month',created_at),'YYYY-MM') AS bucket,count(*)::int AS c FROM users WHERE deleted_at IS NULL AND created_at>=date_trunc('month',now())-interval '5 months' GROUP BY 1"),
  sql.unsafe("SELECT to_char(date_trunc('month',created_at),'YYYY-MM') AS bucket,count(*)::int AS c FROM strategy_instances WHERE created_at>=date_trunc('month',now())-interval '5 months' GROUP BY 1"),
  sql.unsafe("SELECT count(*)::int AS c FROM users WHERE deleted_at IS NULL AND created_at>=now()-interval '30 days'"),
  sql.unsafe("SELECT count(*)::int AS c FROM subscriptions WHERE status IN ('ACTIVE','TRIALING')"),
  sql.unsafe("SELECT count(*)::int AS c FROM billing_webhook_events WHERE status='FAILED' AND created_at>=now()-interval '24 hours'")
 ]);
 const alerts=evaluateOps(await gatherSnapshot());
 const launchLocked=process.env.WEALTHARR_PAID_LAUNCH_ENABLED!=="true";
 const months=Array.from({length:6},(_,i)=>{
  const d=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-5+i,1));
  return {key:d.toISOString().slice(0,7),label:d.toLocaleDateString("en-GB",{month:"short",timeZone:"UTC"})};
 });
 const plotted=months.map(m=>({month:m.label,customers:Number(registrations.find(r=>String(r.bucket)===m.key)?.c??0),
  strategies:Number(createdStrategies.find(r=>String(r.bucket)===m.key)?.c??0)}));
 const pending=Number(attention[0]?.c??0)+Number(failed[0]?.c??0)+alerts.length;
 const cards=[
  {label:"Customers",value:new Intl.NumberFormat("en-GB").format(Number(users[0]?.c??0)),detail:"+"+Number(customers30[0]?.c??0)+" in the last 30 days",href:"/admin/users",Icon:UsersRound},
  {label:"Active strategies",value:new Intl.NumberFormat("en-GB").format(Number(strategies[0]?.c??0)),detail:"Customer strategy instances",href:"/admin/strategies",Icon:Layers3},
  {label:"Monthly revenue",value:"—",detail:"Awaiting reconciled billing figures",href:"/admin/plans",Icon:Wallet},
  {label:"Needs attention",value:new Intl.NumberFormat("en-GB").format(pending),detail:"Operational & strategy issues",href:"/admin/operations",Icon:TriangleAlert}
 ];
 const issues=[
  ...(Number(failed[0]?.c??0)>0?[{key:"deliveries",title:"Notification delivery retries",detail:Number(failed[0]?.c)+" deliveries have repeated failures.",href:"/admin/operations",severity:"critical"}]:[]),
  ...(Number(attention[0]?.c??0)>0?[{key:"portfolios",title:"Strategy health requires review",detail:Number(attention[0]?.c)+" active customer strategies flagged for review.",href:"/admin/users",severity:"warning"}]:[]),
  ...alerts.slice(0,7).map(a=>({key:a.key,title:a.title,detail:a.detail,href:"/admin/operations",severity:a.severity}))
 ];
 return <div className="admin-overview admin-fidelity-overview">
  <div className="admin-design-heading">
   <div><span className="admin-kicker">WORKSPACE / OVERVIEW</span><h1>Overview</h1><p>Business performance and platform health</p></div>
   <span className={"admin-design-status "+(launchLocked?"is-prelaunch":"is-live")}>{launchLocked?"Pre-launch":"Launch enabled"}</span>
  </div>
  <div className="admin-overview-kpis" role="region" aria-label="Key business indicators">{cards.map(({label,value,detail,href,Icon})=>
   <Link key={label} href={href} className="admin-design-kpi">
    <span className="admin-design-kpi-title">{label}<Icon size={17} aria-hidden="true"/></span>
    <strong>{value}</strong><span className="admin-design-kpi-detail">{detail}</span>
   </Link>)}</div>
  <div className="admin-design-grid">
   <AdminGrowthChart points={plotted}/>
   <section className="admin-design-panel admin-attention-panel" aria-labelledby="admin-attention-title">
    <header className="admin-design-panel-header"><div><h2 id="admin-attention-title">Needs attention</h2><p>Prioritised operational issues</p></div><Link href="/admin/operations" aria-label="Open all operations"><ArrowUpRight size={17}/></Link></header>
    {issues.length?issues.slice(0,4).map(a=><Link key={a.key} href={a.href} className="admin-design-issue">
     <span className={"admin-design-issue-symbol "+(a.severity==="critical"?"is-critical":"is-warning")}><ShieldAlert size={16}/></span>
     <span><strong>{a.title}</strong><small>{a.detail}</small></span><ArrowRight size={15}/></Link>):
     <div className="admin-design-empty"><CheckCircle2 size={19}/><strong>No recorded alerts</strong><p>Configured monitoring has no active alerts. External integrations must still be independently tested.</p></div>}
    <Link className="admin-panel-footer-link" href="/admin/launch">Review launch readiness <ArrowRight size={14}/></Link>
   </section>
  </div>
  <section className="admin-design-panel" aria-labelledby="admin-billing-pulse"><header className="admin-design-panel-header"><div><h2 id="admin-billing-pulse">Billing activity</h2><p>Recorded subscription and webhook states; not independently reconciled payments.</p></div><Link href="/admin/plans" aria-label="Open Commerce"><ArrowUpRight size={17}/></Link></header><div className="admin-design-info-row"><span>Active or trial subscriptions</span><strong>{Number(activeSubscriptions[0]?.c??0)}</strong></div><div className="admin-design-info-row"><span>Failed Stripe events · last 24 hours</span><strong className={Number(billingFailures[0]?.c??0)>0?"is-warning":undefined}>{Number(billingFailures[0]?.c??0)}</strong></div><p className="admin-data-caveat">Subscription counts include trials. No monthly recurring revenue is estimated without reconciled transactions.</p><Link href="/admin/plans" className="admin-panel-footer-link">Review Commerce <ArrowRight size={14}/></Link></section>
  <div className="admin-design-grid admin-design-grid-secondary">
   <section className="admin-design-panel" aria-labelledby="admin-strategy-summary">
    <header className="admin-design-panel-header"><div><h2 id="admin-strategy-summary">Strategy Studio</h2><p>Verified releases and research inventory</p></div><Link href="/admin/strategies" aria-label="Open strategy studio"><ArrowUpRight size={17}/></Link></header>
    <div className="admin-design-info-row"><span>Installed strategies</span><strong>{Number(definitions[0]?.total??0)}</strong></div>
    <div className="admin-design-info-row"><span>Customer enabled</span><strong>{Number(definitions[0]?.enabled??0)}</strong></div>
    <div className="admin-design-info-row"><span>Attestation records</span><strong>{Number(attested[0]?.c??0)}</strong></div>
    <Link href="/admin/strategies" className="admin-panel-footer-link">Manage strategies <ArrowRight size={14}/></Link>
   </section>
   <section className="admin-design-panel" aria-labelledby="admin-worker-summary">
    <header className="admin-design-panel-header"><div><h2 id="admin-worker-summary">Recent worker activity</h2><p>Last recorded runs, not live monitoring claims</p></div><Link href="/admin/operations" aria-label="Open worker operations"><ArrowUpRight size={17}/></Link></header>
    {runs.length?runs.slice(0,4).map(r=><div className="admin-design-info-row" key={String(r.worker_key)}>
     <span>{String(r.worker_key)}<small>{r.started_at?new Date(r.started_at).toLocaleString("en-GB"):"No timestamp"}</small></span>
     <strong className={r.status==="SUCCESS"?"is-good":"is-warning"}>{String(r.status)}</strong></div>):
     <div className="admin-design-empty"><p>No worker run has been recorded. Check the scheduler before launch.</p></div>}
    <Link href="/admin/operations" className="admin-panel-footer-link">View operations <ArrowRight size={14}/></Link>
   </section>
  </div>
  <section className="admin-design-quick-links" aria-label="Common administrative tasks">
   <div><h2>Quick access</h2><p>Manage your platform from one place</p></div>
   <div><Link href="/admin/configuration">Continue setup <ArrowRight size={15}/></Link>
    <Link href="/admin/strategies">Strategy Studio <ArrowRight size={15}/></Link>
    <Link href="/admin/integrations">Integrations <PlugZap size={15}/></Link>
    <Link href="/admin/plans">Commerce <ArrowRight size={15}/></Link></div>
  </section>
  <details className="admin-advanced-workflow"><summary><span><strong>Advanced feature flags</strong><small>{flags.length} flags · configuration changes are audited</small></span><span aria-hidden="true">⌄</span></summary><div className="admin-advanced-content">
   <div className="admin-flag-grid">{flags.map(f=><div key={String(f.key)}><span>{String(f.key)}</span><strong>{f.enabled?"On":"Off"}</strong></div>)}</div>
   <FeatureFlagEditor/>
  </div></details>
 </div>;
}
