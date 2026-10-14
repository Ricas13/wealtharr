import Link from "next/link";
import {sql} from "@/lib/db";
import {requireAdminPage} from "@/lib/session";
import {parseAuditFilters,auditPageWindow,auditPageHref} from "@/domain/admin-audit-explorer";

export const dynamic="force-dynamic";

type SearchParams={action?:string|string[];days?:string|string[];page?:string|string[]};
export default async function AuditExplorerPage({searchParams}:{searchParams:Promise<SearchParams>}){
 await requireAdminPage();
 const filters=parseAuditFilters(await searchParams);
 // Filters only match action names and time windows; metadata and event payloads are never selected.
 const conditions=" WHERE ($1::text='' OR strpos(lower(a.action),lower($1::text))>0)"+
  " AND ($2::int=0 OR a.occurred_at>=now()-($2::int * interval '1 day'))";
 const totals=await sql.unsafe("SELECT count(*)::int AS c FROM audit_events a"+conditions,[filters.action,filters.days]);
 const total=Number(totals[0]?.c??0);
 const window=auditPageWindow(total,filters.page);
 const rows=total?await sql.unsafe(
  "SELECT a.action,a.entity_type,a.occurred_at FROM audit_events a"+conditions+
  " ORDER BY a.occurred_at DESC,a.id DESC LIMIT $3 OFFSET $4",
  [filters.action,filters.days,window.limit,window.offset]
 ):[];
 return <div>
  <div className="admin-design-heading">
   <div><span className="admin-kicker">GOVERNANCE / SECURITY / AUDIT</span>
    <h1>Audit event explorer</h1>
    <p>Search recorded administrative and financial actions across their retained history, without exposing sensitive metadata.</p>
   </div>
   <Link href="/admin/security" className="admin-design-button">Back to security</Link>
  </div>
  <section className="admin-design-panel" aria-labelledby="audit-explorer-title">
   <header className="admin-design-panel-header"><div><h2 id="audit-explorer-title">Recorded events</h2>
    <p>50 events per page, newest first; dates are displayed in UTC.</p></div></header>
   <form method="GET" action="/admin/security/audit" className="inline">
    <label htmlFor="audit-action-filter">Action contains</label>
    <input id="audit-action-filter" type="search" name="action" maxLength={64} defaultValue={filters.action}
      placeholder="e.g. settings.changed" autoComplete="off"/>
    <label htmlFor="audit-period-filter">Time window</label>
    <select id="audit-period-filter" name="days" defaultValue={String(filters.days)}>
     <option value="7">Last 7 days</option><option value="30">Last 30 days</option>
     <option value="90">Last 90 days</option><option value="0">All retained events</option>
    </select>
    <button type="submit" className="button primary">Apply filters</button>
   </form>
   {filters.invalidAction&&<p role="alert" className="error">Action filters may contain only letters, digits, dots, underscores, colons and hyphens (up to 64 characters). The invalid filter was not applied.</p>}
   <p className="admin-data-caveat">Showing {rows.length} of {total} matching events · page {window.page} of {window.pages}. Operator identities, customer holdings, raw provider errors, audit metadata and credentials are intentionally excluded.</p>
   {rows.length?<div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Filtered audit event history">
    <table className="admin-studio-table"><thead><tr>
     <th scope="col">ACTION</th><th scope="col">RECORD TYPE</th><th scope="col">OCCURRED (UTC)</th>
    </tr></thead><tbody>{rows.map((r,i)=><tr key={i}>
     <td><strong>{String(r.action)}</strong></td><td>{String(r.entity_type)}</td>
     <td>{new Date(r.occurred_at).toLocaleString("en-GB",{timeZone:"UTC"})} UTC</td>
    </tr>)}</tbody></table>
   </div>:<p className="admin-data-caveat">No audit events match these filters.</p>}
   {window.pages>1&&<nav className="inline" aria-label="Audit event pages">
    {window.page>1?<Link className="button" href={auditPageHref(filters.action,filters.days,window.page-1)}>Previous</Link>:<span>First page</span>}
    <span>Page {window.page} of {window.pages}</span>
    {window.page<window.pages?<Link className="button" href={auditPageHref(filters.action,filters.days,window.page+1)}>Next</Link>:<span>Last page</span>}
   </nav>}
   <p className="admin-data-caveat">Audit records are observations, not proof that external services or financial reconciliation are functioning correctly.</p>
  </section>
 </div>;
}
