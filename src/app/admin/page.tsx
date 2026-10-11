import Link from "next/link";
import {sql} from "@/lib/db";
import {FeatureFlagEditor} from "@/components/AdminEditors";
import {gatherSnapshot} from "@/lib/ops-monitor";
import {evaluateOps} from "@/domain/ops-health";

export const dynamic="force-dynamic";

export default async function AdminPage(){
 const [users,strategies,failed,attention,runs,flags,definitions,attested]=await Promise.all([
  sql.unsafe("SELECT count(*)::int AS c FROM users WHERE deleted_at IS NULL"),
  sql.unsafe("SELECT count(*)::int AS c FROM strategy_instances WHERE status='ACTIVE'"),
  sql.unsafe("SELECT count(*)::int AS c FROM notification_deliveries WHERE status='PENDING' AND attempt_count>2"),
  sql.unsafe("SELECT count(*)::int AS c FROM strategy_instances WHERE health_status<>'HEALTHY' AND status='ACTIVE'"),
  sql.unsafe("SELECT DISTINCT ON (worker_key) worker_key,status,started_at,finished_at FROM worker_runs ORDER BY worker_key,started_at DESC"),
  sql.unsafe("SELECT key,enabled,updated_at FROM feature_flags ORDER BY key"),
  sql.unsafe("SELECT count(*)::int AS total,count(*) FILTER (WHERE enabled=true)::int AS enabled FROM strategy_definitions"),
  sql.unsafe("SELECT count(*)::int AS c FROM strategy_version_attestations")
 ]);
 const alerts=evaluateOps(await gatherSnapshot());
 const launchLocked=process.env.WEALTHARR_PAID_LAUNCH_ENABLED!=="true";
 const cards=[
  {label:"Registered users",value:Number(users[0]?.c??0),info:"Accounts created",href:"/admin/users"},
  {label:"Live strategies",value:Number(strategies[0]?.c??0),info:"Customer portfolios",href:"/admin/strategies"},
  {label:"Action required",value:Number(attention[0]?.c??0)+alerts.length,info:"Portfolio & system alerts",href:"/admin/operations"},
  {label:"Delivery retries",value:Number(failed[0]?.c??0),info:"Delayed notifications",href:"/admin/operations"}
 ];
 return <div className="admin-overview">
  <div className="admin-overview-heading"><div><div className="eyebrow">MASTER ADMIN / OVERVIEW</div><h1>Workspace overview</h1><p>Manage Wealtharr without digging through configuration tables.</p></div><Link className="button primary" href="/admin/configuration">Continue setup →</Link></div>
  <section className="admin-overview-hero">
    <div className="admin-overview-hero-main">
      <div className="admin-overview-hero-label">PLATFORM STATUS</div>
      <h2>{launchLocked?"Your workspace is in pre-launch mode.":"Paid launch is enabled."}</h2>
      <p>{launchLocked?"The platform is available for setup and testing; paid checkout remains disabled until launch approval.":"Review provider health, licence evidence and system alerts continuously."}</p>
      <div className="admin-overview-hero-links"><Link className="button primary" href="/admin/launch">View launch checks →</Link><Link className="button" href="/admin/settings">Configure providers</Link></div>
    </div>
    <div className="admin-overview-hero-side">
      <span className="admin-side-kicker">STRATEGY LIBRARY</span>
      <strong>{Number(definitions[0]?.total??0)} <small>profiles installed</small></strong>
      <div className="admin-side-stat"><span>Customer enabled</span><b>{Number(definitions[0]?.enabled??0)}</b></div>
      <div className="admin-side-stat"><span>Signed-off versions</span><b>{Number(attested[0]?.c??0)}</b></div>
      <Link href="/admin/strategies" className="admin-side-link">Open strategy catalogue ↗</Link>
    </div>
  </section>
  <div className="admin-overview-metrics">{cards.map(card=><Link className="admin-overview-metric" href={card.href} key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.info} <span aria-hidden="true">↗</span></small></Link>)}</div>
  <div className="admin-overview-panels">
   <section className="admin-overview-panel">
     <div className="admin-panel-title"><div><span className="eyebrow">OPERATIONS</span><h2>Attention queue</h2></div><Link href="/admin/operations">All operations →</Link></div>
     {alerts.length?alerts.map(a=><div className="admin-activity-row" key={a.key}><span className={"admin-activity-dot "+(a.severity==="critical"?"critical":"")}/><div><strong>{a.title}</strong><small>{a.detail}</small></div><b>{a.severity==="critical"?"Critical":"Warning"}</b></div>):<div className="admin-panel-empty"><strong>No active monitoring alerts</strong><p>This only covers the checks that are configured. Unconfigured third-party services still need setup and testing.</p></div>}
   </section>
   <section className="admin-overview-panel">
     <div className="admin-panel-title"><div><span className="eyebrow">AUTOMATION</span><h2>Recent workers</h2></div><Link href="/admin/operations">View jobs →</Link></div>
     {runs.length?runs.slice(0,7).map(r=><div className="admin-activity-row" key={String(r.worker_key)}><span className={"admin-activity-dot "+(r.status==="SUCCESS"?"":"critical")}/><div><strong>{String(r.worker_key)}</strong><small>{r.started_at?new Date(r.started_at).toLocaleString("en-GB"):"Not started"}</small></div><b>{String(r.status)}</b></div>):<div className="admin-panel-empty"><strong>No worker history yet</strong><p>The hourly jobs will appear after their first recorded execution.</p></div>}
   </section>
  </div>
  <section className="admin-quick-start"><div><span className="eyebrow">QUICK ACCESS</span><h2>Common tasks</h2></div>
    <div><Link href="/admin/strategies">Explore strategies <span>↗</span></Link><Link href="/admin/instruments">Map investment products <span>↗</span></Link><Link href="/admin/plans">Configure pricing <span>↗</span></Link><Link href="/admin/settings">Connect integrations <span>↗</span></Link></div>
  </section>
  <details className="admin-advanced-workflow"><summary><span><strong>Advanced feature flags</strong><small>{flags.length} configured flags · change with care</small></span><span aria-hidden="true">⌄</span></summary><div className="admin-advanced-content">
    <div className="admin-flag-grid">{flags.map(f=><div key={String(f.key)}><span>{String(f.key)}</span><strong>{f.enabled?"On":"Off"}</strong></div>)}</div>
    <FeatureFlagEditor/>
  </div></details>
 </div>;
}
