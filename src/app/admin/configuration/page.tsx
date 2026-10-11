import Link from "next/link";
import {sql} from "@/lib/db";
import {ensureSettings} from "@/lib/settings";
import {masterSetupSignals} from "@/domain/master-setup";

export const dynamic="force-dynamic";

/** The configuration screen never transmits credential values to the browser. */
export default async function MasterConfigurationPage(){
  await ensureSettings(true);
  const [plans,strategies,mappings,cron,backup]=await Promise.all([
    sql.unsafe("SELECT count(*)::int AS n FROM plan_prices WHERE active=true"),
    sql.unsafe("SELECT count(*)::int AS n FROM strategy_definitions d WHERE d.enabled=true AND EXISTS (SELECT 1 FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED')"),
    sql.unsafe("SELECT count(*)::int AS n FROM regional_instrument_mappings WHERE enabled=true AND fidelity='EXACT'"),
    sql.unsafe("SELECT started_at FROM worker_runs WHERE worker_key='cron-actions' AND status='SUCCESS' ORDER BY started_at DESC LIMIT 1"),
    sql.unsafe("SELECT started_at FROM worker_runs WHERE worker_key='backup' AND status='SUCCESS' ORDER BY started_at DESC LIMIT 1")
  ]);
  const configured=(...names:string[])=>names.every(key=>Boolean(process.env[key]));
  const signals=masterSetupSignals({
    publicUrl:Boolean(process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://")),
    brand:configured("NEXT_PUBLIC_BRAND_NAME"),
    mfa:process.env.ADMIN_MFA_REQUIRED==="true",
    stripe:configured("STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET"),
    email:process.env.EMAIL_PROVIDER==="http"&&configured("EMAIL_HTTP_ENDPOINT","EMAIL_HTTP_TOKEN","EMAIL_FROM"),
    market:process.env.MARKET_DATA_MODE!=="MANUAL"&&process.env.MARKET_DATA_PROVIDER==="http"&&
      configured("MARKET_DATA_HTTP_BASE_URL","MARKET_DATA_HTTP_TOKEN"),
    notifications:process.env.EMAIL_PROVIDER==="http"&&configured("EMAIL_FROM","EMAIL_HTTP_ENDPOINT","EMAIL_HTTP_TOKEN"),
    indexing:process.env.PUBLIC_INDEXING_ENABLED==="true",
    plans:Number(plans[0]?.n??0),
    publishedStrategies:Number(strategies[0]?.n??0),
    approvedMappings:Number(mappings[0]?.n??0),
    lastCronAt:cron[0]?.started_at?new Date(cron[0].started_at):null,
    backupAt:backup[0]?.started_at?new Date(backup[0].started_at):null,
    backupExpected:process.env.OPS_EXPECT_BACKUP_HEARTBEAT==="true",
    attestations:["BACKUPS_RESTORE_VERIFIED","UK_REGULATORY_SIGNOFF_VERIFIED","REGIONAL_INSTRUMENTS_VERIFIED"]
      .every(k=>process.env[k]==="true"),now:new Date()
  });
  const ready=signals.filter(s=>s.status==="configured").length;
  return <div className="stack">
    <div className="page-title"><div><div className="eyebrow">Master Admin</div><h1>Set up Wealtharr</h1>
      <p>Clone, deploy, create the first administrator, then configure your product here. No edits to strategy code or environment files for normal operator settings.</p></div></div>
    <section className="card"><h2>{ready} of {signals.length} areas configured</h2>
      <p className="help">Configuration status is not a commercial launch approval. Strategy calculations, regional equivalence, data licensing and legal sign-offs must be verified separately. Items marked “Verify evidence” never count as production-ready on their own.</p>
      <p><Link href="/admin/settings">Integration settings</Link> · <Link href="/admin/operations">Connection tests and jobs</Link> · <Link href="/admin/launch">Launch checks</Link></p>
    </section>
    <div className="detail-grid">
      {signals.map(signal=><section className="card" key={signal.id}>
        <div className="why-row"><h3>{signal.title}</h3><span className="pill">{signal.status==="configured"?"Configured":signal.status==="requires-verification"?"Verify evidence":"Needs setup"}</span></div>
        <p className="help">{signal.detail}</p>
        <Link className="button" href={signal.href}>Configure or inspect</Link>
      </section>)}
    </div>
    <section className="card"><h2>Docker Compose: bootstrap only</h2><p className="help">Configure the database URL and password, authentication/encryption keys, reverse proxy, shared scheduler secret, host ports, persistent storage and backup container settings in Docker Compose or its private deployment environment. These values cannot be safely changed in an app database they unlock. Everything else above is managed through the web UI.</p>
      <p className="help">A green checkbox is never permission to trade from unverified instruments or enable paid checkout without independent sign-off.</p>
    </section>
  </div>;
}
