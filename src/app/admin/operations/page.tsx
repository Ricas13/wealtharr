import { sql } from "@/lib/db";
import {gatherSnapshot} from "@/lib/ops-monitor";
import {evaluateOps} from "@/domain/ops-health";
import {safeBillingErrorCode} from "@/domain/billing-event-diagnostics";
import {requireAdminPage} from "@/lib/session";
import { RetryDeliveries } from "@/components/RetryDeliveries";
import { IntegrationTests } from "@/components/IntegrationTests";
import { checkCommercialLaunch } from "@/domain/commercial-launch";
import { ensureSettings } from "@/lib/settings";
export const dynamic="force-dynamic";
const explanations:Record<string,string>={
 stripe_live:"Enter the Stripe key in Admin › Settings › Billing. It is stored encrypted and never shown again.",
 stripe_webhook:"Register /api/stripe/webhook with Stripe and enter the signing secret in Admin › Settings › Billing. Webhook events below show actual processing results.",
 email:"Enter the email service details in Admin › Settings › Email; use a supported transactional provider.",
 market_data_mode:"Connect a quote provider offering live prices, historical intraday observations, currencies and adjusted data.",
 worker_auth:"Set the same CRON_SECRET in the app and scheduler through private Docker Compose configuration. Review execution and failures below.",
 backup_operator_attestation:"Configure encrypted offsite backups and demonstrate a restore before attesting success."
};
export default async function OperationsPage(){
 await requireAdminPage();
 await ensureSettings(true);
 const checks=checkCommercialLaunch(process.env);
 const alerts=evaluateOps(await gatherSnapshot());
 const [jobs,delivery,webhooks,billingIssues]=await Promise.all([
  sql.unsafe("SELECT DISTINCT ON (worker_key) worker_key,status,started_at,finished_at FROM worker_runs ORDER BY worker_key,started_at DESC LIMIT 50"),
  sql.unsafe("SELECT channel,status,count(*)::int AS n FROM notification_deliveries GROUP BY channel,status ORDER BY channel,status"),
  sql.unsafe("SELECT status,count(*)::int AS n FROM billing_webhook_events GROUP BY status ORDER BY status"),
  sql.unsafe("SELECT event_type,status,last_error_code,created_at FROM billing_webhook_events WHERE status='FAILED' OR (status='PROCESSING' AND created_at<now()-interval '15 minutes') ORDER BY created_at DESC LIMIT 20")
 ]);
 const sections=[
  {title:"Payments · Stripe",keys:["stripe_live","stripe_webhook"]},
  {title:"Email delivery",keys:["email"]},
  {title:"Automated pricing",keys:["market_data_mode"]},
  {title:"Scheduled jobs",keys:["worker_auth"]},
  {title:"Backups and recovery",keys:["backup_operator_attestation"]}
 ];
 return <><div className="page-title"><div><div className="eyebrow">Admin · Operations</div><h1>Integrations and jobs</h1><p>Configuration status and recorded operational outcomes. Credentials are never exposed; a configured credential is not proof of a successful connection.</p></div></div>
 <section className="card" aria-labelledby="ops-alerts-title" style={{marginBottom:18}}><h2 id="ops-alerts-title">Active operational alerts ({alerts.length})</h2><p className="help">Evaluated from recorded activity and configured expectations. No alerts does not establish that external services or disaster recovery have been tested.</p>{alerts.length?<div role="list">{alerts.map(a=><div role="listitem" className="why-row" key={a.key}><span><strong>{a.severity==="critical"?"Critical":"Warning"}: {a.title}</strong><br/><small>{a.detail}</small></span></div>)}</div>:<p className="help">No active alerts from the configured monitoring rules.</p>}</section>
 <div className="detail-grid">{sections.map(section=><section className="card" key={section.title}><h3>{section.title}</h3>{section.keys.map(key=>{const c=checks.find(v=>v.key===key);return <div key={key}><p><strong>{c?.passed?"Configured":"Needs setup"}</strong></p><p className="help">{explanations[key]}</p></div>;})}</section>)}</div>
 <div className="detail-grid" style={{marginTop:18}}>
 <section className="card"><h3>Stripe webhook processing</h3>{webhooks.length?webhooks.map((w:any)=><div className="why-row" key={w.status}><span>{w.status}</span><strong>{w.n}</strong></div>):<p className="help">No webhook events recorded.</p>}<p><a href="/admin/plans">Manage plans and prices</a></p></section>
 <section className="card"><h3>Notification deliveries</h3>{delivery.length?delivery.map((d:any)=><div className="why-row" key={d.channel+":"+d.status}><span>{d.channel} · {d.status}</span><strong>{d.n}</strong></div>):<p className="help">No delivery attempts recorded.</p>}</section>
 </div>
 <section className="card" style={{marginTop:18}} aria-labelledby="billing-issues-title"><h3 id="billing-issues-title">Billing events needing attention</h3>
 <p className="help">Most recent 20 failed Stripe events or events still processing after 15 minutes. Customer identifiers and raw provider errors are not displayed. Review protected logs and Stripe before taking corrective action; replay must use the existing idempotent webhook workflow.</p>
 {billingIssues.length?<div className="table-wrap" role="region" tabIndex={0} aria-label="Billing events needing attention">
 <table><thead><tr><th scope="col">EVENT TYPE</th><th scope="col">STATUS</th><th scope="col">RECEIVED (UTC)</th><th scope="col">SAFE ERROR CODE</th></tr></thead>
 <tbody>{billingIssues.map((item,i)=><tr key={i}><td>{String(item.event_type)}</td><td>{String(item.status)}</td><td>{new Date(item.created_at).toLocaleString("en-GB",{timeZone:"UTC"})} UTC</td><td>{item.status==="FAILED"?safeBillingErrorCode(item.last_error_code):"Processing exceeded 15 minutes"}</td></tr>)}</tbody></table></div>:
 <p className="help">No failed or stuck billing events currently recorded. This does not establish that Stripe webhook delivery is functioning.</p>}
 </section>
 <div style={{marginTop:18}}><IntegrationTests/></div>
 <div style={{marginTop:18}}><RetryDeliveries/></div>
 <section className="card" style={{marginTop:18}}><h3>Latest worker executions</h3>{jobs.length?jobs.map((job:any)=><div className="why-row" key={job.worker_key}><span>{job.worker_key}<small> · {new Date(job.started_at).toLocaleString("en-GB")}</small></span><strong>{job.status}</strong></div>):<p className="help">No runs recorded. Verify the scheduler service is running.</p>}</section>
 <section className="card" style={{marginTop:18}}><h3>Provider credentials</h3><p className="help">Configure Stripe, email and market-data credentials in Master Admin → Settings. Sensitive values are encrypted at rest, never read back into the browser, and changes are audited. Provider tests use fixed operations rather than arbitrary URLs. Docker credentials and the scheduler secret remain deployment settings.</p><a className="button" href="/admin/settings">Edit integrations and secrets</a></section></>;
}
