import { sql } from "@/lib/db";
import { FeatureFlagEditor } from "@/components/AdminEditors";
import { gatherSnapshot } from "@/lib/ops-monitor";
import { evaluateOps } from "@/domain/ops-health";
export default async function AdminPage(){
  const [users,strategies,failed,attention,runs,flags]=await Promise.all([
    sql.unsafe("SELECT count(*)::int AS c FROM users WHERE deleted_at IS NULL"),
    sql.unsafe("SELECT count(*)::int AS c FROM strategy_instances WHERE status='ACTIVE'"),
    sql.unsafe("SELECT count(*)::int AS c FROM notification_deliveries WHERE status='PENDING' AND attempt_count>2"),
    sql.unsafe("SELECT count(*)::int AS c FROM strategy_instances WHERE health_status<>'HEALTHY' AND status='ACTIVE'"),
    sql.unsafe("SELECT DISTINCT ON (worker_key) worker_key,status,started_at,finished_at,details FROM worker_runs ORDER BY worker_key,started_at DESC"),
    sql.unsafe("SELECT key,enabled,updated_at FROM feature_flags ORDER BY key")
  ]);
  const alerts=evaluateOps(await gatherSnapshot());
  return <><div className="page-title"><div><div className="eyebrow">Master Admin</div><h1>System health</h1><p>Operational status without exposing customer balances.</p></div></div>
  <section className="card" style={{marginBottom:16}}><h2>Configure Wealtharr from the browser</h2><p className="help">The Master setup page brings your strategies, markets, providers, plans and operational checks together in one guided workflow. Only infrastructure/bootstrap settings stay in Docker Compose.</p><a className="button primary" href="/admin/configuration">Open Master setup</a></section>
  <section className="card" style={{marginBottom:16}} aria-live="polite"><h3>{alerts.length?`${alerts.length} problem${alerts.length===1?"":"s"} need attention`:"No operational problems detected"}</h3>{alerts.map((a)=><div className="why-row" key={a.key}><span>{a.title}<br/><small>{a.detail}</small></span><b>{a.severity==="critical"?"Critical":"Warning"}</b></div>)}{!alerts.length&&<p className="help">Checks the hourly job, price refresh, billing notifications, notification delivery and backups. {process.env.OPS_ALERTS_ENABLED==="true"?"Email alerts are on.":"Email alerts are off (Admin › Settings › Monitoring)."}</p>}</section>
  <div className="admin-grid"><div className="glass metric"><small>Users</small><strong>{users[0].c}</strong></div><div className="glass metric"><small>Active strategies</small><strong>{strategies[0].c}</strong></div><div className="glass metric"><small>Failed deliveries</small><strong>{failed[0].c}</strong></div><div className="glass metric"><small>Needs attention</small><strong>{attention[0].c}</strong></div></div>
  <div className="detail-grid"><section className="card"><h3>Workers</h3>{runs.length?runs.map((r:any)=><div className="why-row" key={r.worker_key}><span>{r.worker_key}<br/><small>{new Date(r.started_at).toLocaleString("en-GB")}</small></span><b>{r.status}</b></div>):<p className="help">No worker run recorded yet.</p>}</section>
  <section className="card"><h3>Providers & flags</h3><div className="why-row"><span>Market data provider</span><b>{process.env.MARKET_DATA_PROVIDER==="http"?"HTTPS provider configured":process.env.MARKET_DATA_PROVIDER==="mock"&&process.env.NODE_ENV!=="production"?"Development mock":"Not configured (actions fail closed)"}</b></div><div className="why-row"><span>Email provider</span><b>{process.env.EMAIL_PROVIDER??"unconfigured"}</b></div>{flags.map((f:any)=><div className="why-row" key={f.key}><span>{f.key}</span><b>{f.enabled?"ON":"OFF"}</b></div>)}</section></div><div style={{marginTop:18}}><FeatureFlagEditor/></div></>;
}
