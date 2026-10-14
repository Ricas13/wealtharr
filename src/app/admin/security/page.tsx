import Link from "next/link";
import {ShieldCheck,LockKeyhole,ScrollText,DatabaseBackup,ArrowRight} from "lucide-react";
import {requireAdminPage} from "@/lib/session";
import {sql} from "@/lib/db";
import {isMfaEnabled} from "@/lib/mfa";

export const dynamic="force-dynamic";
export default async function AdminSecurityPage(){
 const user=await requireAdminPage();
 const [mfa,audit,connectionTests]=await Promise.all([
  isMfaEnabled(user.id),
  sql.unsafe("SELECT action,entity_type,occurred_at FROM audit_events ORDER BY occurred_at DESC LIMIT 15"),
  sql.unsafe("SELECT metadata->>'service' AS service,metadata->>'ok' AS ok,occurred_at FROM audit_events WHERE action='integration.connection-test' AND metadata->>'service' IN ('STRIPE','EMAIL','MARKET_DATA','MARKET_DATA_HISTORY','TELEGRAM') ORDER BY occurred_at DESC LIMIT 12")
 ]);
 return <div>
  <div className="admin-design-heading"><div><span className="admin-kicker">GOVERNANCE / SECURITY</span>
   <h1>Security & audit</h1><p>Privileged access, recorded changes and recovery evidence.</p></div>
   <Link className="admin-design-button" href="/admin/launch"><ShieldCheck size={16}/> Launch checks</Link>
  </div>
  <div className="admin-security-grid">
   <section className="admin-design-panel">
    <div className="admin-security-card-icon"><LockKeyhole size={21}/></div>
    <h2>Administrator access</h2>
    <p>Two-step sign-in is {mfa?"enabled":"not yet enabled"} for this account. Platform-wide enforcement must also be configured and independently tested.</p>
    <Link className="admin-panel-footer-link" href="/app/settings#security">Manage your two-step sign-in <ArrowRight size={15}/></Link>
   </section>
   <section className="admin-design-panel">
    <div className="admin-security-card-icon"><DatabaseBackup size={21}/></div>
    <h2>Backups & recovery</h2>
    <p>Review recorded backup jobs and restore sign-off. A successful heartbeat does not establish recoverability.</p>
    <Link className="admin-panel-footer-link" href="/admin/launch">Review recovery evidence <ArrowRight size={15}/></Link>
   </section>
  </div>
  <section className="admin-design-panel admin-audit-panel" aria-labelledby="admin-provider-tests-title">
   <header className="admin-design-panel-header"><div><h2 id="admin-provider-tests-title">Recent integration tests</h2><p>Last 12 administrator-triggered checks, as recorded in the audit log</p></div></header>
   {connectionTests.length?<div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Provider connection test history"><table className="admin-studio-table">
    <thead><tr><th scope="col">Provider check</th><th scope="col">Recorded result</th><th scope="col">When (UTC)</th></tr></thead>
    <tbody>{connectionTests.map((row,i)=><tr key={i}><td>{String(row.service)}</td><td>{row.ok==="true"?"Test passed":"Test failed"}</td><td>{new Date(row.occurred_at).toLocaleString("en-GB",{timeZone:"UTC"})} UTC</td></tr>)}</tbody>
   </table></div>:<p className="admin-setup-help">No administrator-triggered provider tests recorded yet.</p>}
   <p className="admin-data-caveat">A passed test means the individual provider operation returned success. It does not verify customer payment flows, delivery to an inbox, commercial data rights or production launch readiness. Only approved service names and results are shown.</p>
   <Link href="/admin/operations" className="admin-panel-footer-link">Open connection tests <ArrowRight size={15}/></Link>
  </section>
  <section className="admin-design-panel admin-audit-panel" aria-labelledby="admin-audit-title">
   <header className="admin-design-panel-header"><div><h2 id="admin-audit-title">Latest audit events</h2><p>Recorded administrative and financial changes · most recent 15</p></div><ScrollText size={19} aria-hidden="true"/></header>
   {audit.length?<div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Recent audit events"><table className="admin-studio-table">
    <thead><tr><th scope="col">Action</th><th scope="col">Record type</th><th scope="col">When (server time)</th></tr></thead>
    <tbody>{audit.map((row,i)=><tr key={i}><td><strong>{String(row.action)}</strong></td><td>{String(row.entity_type)}</td><td>{new Date(row.occurred_at).toLocaleString("en-GB")}</td></tr>)}</tbody>
   </table></div>:<p className="admin-setup-help">No audit events have been recorded yet.</p>}
   <p className="admin-data-caveat">This view intentionally excludes credentials, detailed customer holdings and audit metadata containing sensitive values.</p>
   <Link href="/admin/security/audit" className="admin-panel-footer-link">Browse full audit history <ArrowRight size={15}/></Link>
  </section>
 </div>;
}
