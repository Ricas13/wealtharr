import { checkCommercialLaunch } from "@/domain/commercial-launch";
import { sql } from "@/lib/db";
import { customerStrategyEvidence } from "@/lib/strategy-evidence";
import { ensureSettings } from "@/lib/settings";
export const dynamic="force-dynamic";
const descriptions:Record<string,{title:string;where:string}>={
 application_url:{title:"Public HTTPS URL",where:"Set the public web address in Admin › Settings › General."},
 database:{title:"Production PostgreSQL",where:"Provision PostgreSQL, set DATABASE_URL through your host's secret manager and test a restore."},
 auth_secret:{title:"Authentication secret",where:"Generate an independent cryptographic AUTH_SECRET in your secret manager."},
 encryption:{title:"Encryption key",where:"Generate and securely store a 32-byte APP_ENCRYPTION_KEY; do not rotate without a migration plan."},
 worker_auth:{title:"Scheduled worker authentication",where:"Set matching CRON_SECRET values in the app and scheduler through private Docker Compose configuration; the setting cannot be changed from the web UI."},
 stripe_live:{title:"Stripe Live",where:"Enter the Stripe key in Admin › Settings › Billing; manage plans and Stripe price IDs on the Plans page."},
 stripe_webhook:{title:"Stripe webhook signing",where:"Create the Stripe webhook, then enter its signing secret in Admin › Settings › Billing."},
 email:{title:"Transactional email",where:"Enter the email service details in Admin › Settings › Email."},
 market_data_mode:{title:"Licensed market data",where:"Enter the market data service in Admin › Settings › Market data. It must offer intraday history, current quotes and adjusted prices. Users may confirm or correct actual fills."},
 backup_operator_attestation:{title:"Backup restoration evidence",where:"Perform a real point-in-time restore drill. Only then tick the backup sign-off in Admin › Settings › Launch sign-offs."},
 regulatory_signoff:{title:"UK legal and regulatory review",where:"Get written UK regulatory/financial-promotion and privacy advice. Do not self-certify legal approval."},
 instrument_review:{title:"UK ISA and regional instruments",where:"Use Instruments to map actual eligible trading lines and verify broker/ISA tradability before ticking the instruments sign-off in Admin › Settings › Launch sign-offs."},
 admin_mfa:{title:"Administrator two-step sign-in",where:"Every admin turns on two-step sign-in under Settings, then switch on the admin requirement in Admin › Settings › Security."}
};
export default async function LaunchPage(){
 await ensureSettings(true);
 const checks=checkCommercialLaunch(process.env);
 const passing=checks.filter(x=>x.passed).length;
 const strategyEvidence=await customerStrategyEvidence();
 const [workers,prices,mappings]=await Promise.all([
  sql.unsafe("SELECT DISTINCT ON (worker_key) worker_key,status,started_at FROM worker_runs ORDER BY worker_key,started_at DESC"),
  sql.unsafe("SELECT count(*)::int AS c FROM plan_prices WHERE active=true"),
  sql.unsafe("SELECT count(*)::int AS c FROM regional_instrument_mappings WHERE enabled=true")
 ]);
 return <><div className="page-title"><div><div className="eyebrow">Admin · Launch</div><h1>Launch readiness</h1><p>Configure providers in Admin › Settings, then verify actual service behaviour before accepting customers. No secrets are shown here.</p></div></div>
 <section className="card"><h2>{passing}/{checks.length} configuration gates passed</h2><p className="help">{passing===checks.length?"Configuration checks passed. Live integration, licensing, and documented approvals still need independent verification.":"Commercial launch is blocked until the required gates pass."}</p>
 <div className="detail-grid"><div className="glass metric"><small>Active plan prices</small><strong>{prices[0]?.c??0}</strong></div><div className="glass metric"><small>Enabled instrument mappings</small><strong>{mappings[0]?.c??0}</strong></div></div></section>
 <div className="detail-grid" style={{marginTop:16}}>{checks.map(check=>{const item=descriptions[check.key];return <section className="card" key={check.key}><h3>{check.passed?"✓":"○"} {item.title}</h3><p><strong>{check.passed?"Configured":"Action required"}</strong></p><p className="help">{check.passed?"Environment preflight passed; validate with live service evidence.":check.reason}</p><p className="help">{item.where}</p></section>;})}</div>
 <section className="card" style={{marginTop:16}}><h2>Customer-visible strategies</h2><p className="help">Live payments stay blocked until every strategy customers can start has a recorded specification sign-off (Admin › Strategies, Attest). A sign-off records who approved a specification card; it does not verify the card.</p>{strategyEvidence.length?<div className="table-wrap" tabIndex={0} role="region" aria-label="Customer-visible strategies"><table><thead><tr><th>Strategy</th><th>Version</th><th>Sign-off</th></tr></thead><tbody>{strategyEvidence.map(row=><tr key={row.key}><td>{row.name}</td><td>{row.version}</td><td>{row.attested?"Recorded":"Missing"}</td></tr>)}</tbody></table></div>:<p>No strategy is currently visible to customers.</p>}</section>
 <section className="card" style={{marginTop:16}}><h2>Operational evidence</h2><p className="help">A configured URL or token does not prove the provider works. Check recent worker executions and complete real payment/email/data/restore tests.</p>{workers.length?workers.map((w:any)=><div className="why-row" key={w.worker_key}><span>{w.worker_key}</span><b>{w.status} · {new Date(w.started_at).toLocaleString("en-GB")}</b></div>):<p>No worker executions recorded.</p>}</section>
 <section className="card" style={{marginTop:16}}><h2>Where to configure</h2><p><a href="/admin/plans">Plans and Stripe prices</a> · <a href="/admin/strategies">Strategies and versions</a> · <a href="/admin/instruments">Regional instruments</a></p><p className="help">Hosting, secret storage, backup policy, and regulator sign-off are external operator responsibilities. This dashboard never stores or displays raw secrets.</p></section></>;
}
