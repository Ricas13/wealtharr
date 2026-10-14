import Link from "next/link";
import {requireAdminPage} from "@/lib/session";
import {sql} from "@/lib/db";
import {ensureSettings} from "@/lib/settings";
import {masterSetupSignals} from "@/domain/master-setup";
import {checkCommercialLaunch} from "@/domain/commercial-launch";
import {CheckCircle2,Circle,ArrowRight,ShieldCheck,LockKeyhole} from "lucide-react";

export const dynamic="force-dynamic";
export default async function MasterConfigurationPage(){
 await requireAdminPage();
  await ensureSettings(true);
  const [plans,strategies,mappings,cron,backup]=await Promise.all([
    sql.unsafe("SELECT count(*)::int AS n FROM plan_prices WHERE active=true"),
    sql.unsafe("SELECT count(*)::int AS n FROM strategy_definitions d WHERE d.enabled=true AND EXISTS (SELECT 1 FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED')"),
    sql.unsafe("SELECT count(*)::int AS n FROM regional_instrument_mappings WHERE enabled=true AND fidelity='EXACT'"),
    sql.unsafe("SELECT started_at FROM worker_runs WHERE worker_key='cron-actions' AND status IN ('SUCCESS','PARTIAL') ORDER BY started_at DESC LIMIT 1"),
    sql.unsafe("SELECT started_at FROM worker_runs WHERE worker_key='backup' AND status='SUCCESS' ORDER BY started_at DESC LIMIT 1")
  ]);
  const configured=(...names:string[])=>names.every(key=>Boolean(process.env[key]));
  const turnstileConfigured=checkCommercialLaunch(process.env).some(check=>check.key==="turnstile"&&check.passed);
  const signals=masterSetupSignals({
    publicUrl:Boolean(process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://")),
    brand:configured("NEXT_PUBLIC_BRAND_NAME"),
    mfa:process.env.ADMIN_MFA_REQUIRED==="true",
    turnstileConfigured,
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

 const steps=[
  {name:"Create Master Admin and secure MFA",keys:["security"],href:"/app/settings#security"},
  {name:"Configure and test Cloudflare Turnstile",keys:["turnstile"],href:"/admin/settings#settings-cloudflare-turnstile"},
  {name:"Set platform identity, region and currency",keys:["site"],href:"/admin/settings#settings-general"},
  {name:"Configure market data and brokerage providers",keys:["market"],href:"/admin/integrations"},
  {name:"Configure subscription plans and payments",keys:["plans","stripe"],href:"/admin/plans"},
  {name:"Review and publish verified strategies",keys:["catalogue","instruments"],href:"/admin/strategies"},
  {name:"Test email and notification delivery",keys:["email","notifications"],href:"/admin/operations"},
  {name:"Complete launch readiness checks",keys:["workers","backup","launch"],href:"/admin/launch"}
 ];
 const progress=steps.map(step=>{
  const checks=step.keys.map(id=>signals.find(s=>s.id===id)).filter(s=>s!==undefined);
  const complete=checks.length===step.keys.length&&checks.every(s=>s.status==="configured");
  const review=!complete&&checks.some(s=>s.status==="requires-verification");
  return {...step,complete,review};
 });
 const finished=progress.filter(s=>s.complete).length;
 return <div className="admin-wizard">
  <div className="admin-design-heading"><div><span className="admin-kicker">SETUP / GUIDED CONFIGURATION</span>
   <h1>Set up Wealtharr</h1><p>Clone, deploy, then configure your product in the web GUI.</p></div>
   <Link className="admin-design-button" href="/admin/launch"><ShieldCheck size={16}/> Launch review</Link>
  </div>
  <section className="admin-design-panel admin-setup-panel" aria-labelledby="admin-setup-title">
   <div className="admin-setup-header"><div><h2 id="admin-setup-title">Platform setup</h2>
    <p>Follow each step to configure and verify the production environment.</p></div>
    <span className="admin-setup-fraction">{finished} of {steps.length} configured</span></div>
   <div className="admin-setup-progress" role="progressbar" aria-valuenow={finished} aria-valuemin={0} aria-valuemax={steps.length} aria-label="Configuration progress">
    <div style={{width:(100*finished/steps.length)+"%"}}/></div>
   <ol className="admin-setup-steps">
    {progress.map((step,i)=><li key={step.name}>
     <span className={"admin-setup-step-icon"+(step.complete?" is-complete":"")} aria-hidden="true">{step.complete?<CheckCircle2 size={21}/>:<Circle size={21}/>}</span>
     <Link href={step.href}><span className="admin-setup-step-number">STEP {String(i+1).padStart(2,"0")}</span>
      <strong>{step.name}</strong></Link>
     <span className={"admin-setup-step-state "+(step.complete?"is-complete":step.review?"is-review":"")}>{step.complete?"Configured":step.review?"Verify evidence":"Needs setup"}</span>
     <Link href={step.href} className="admin-setup-step-arrow" aria-label={"Configure "+step.name}><ArrowRight size={18}/></Link>
    </li>)}
   </ol>
   <p className="admin-setup-help"><LockKeyhole size={15} aria-hidden="true"/> Setup checkmarks verify saved configuration only. Methodology validation, actual transactions, provider licences, restores and regulatory approvals remain separate requirements.</p>
  </section>
  <details className="admin-advanced-workflow"><summary><span><strong>Full configuration checklist</strong>
   <small>{ready} of {signals.length} component signals configured · inspect every verification item</small></span><span aria-hidden="true">⌄</span></summary>
   <div className="admin-advanced-content">
    {signals.map(s=><div className="admin-setup-detail" key={s.id}>
     <div><strong>{s.title}</strong><p>{s.detail}</p></div>
     <span>{s.status==="configured"?"Configured":s.status==="requires-verification"?"Verify evidence":"Needs setup"}</span>
     <Link href={s.href} aria-label={"Configure "+s.title}><ArrowRight size={16}/></Link>
    </div>)}
   </div>
  </details>
  <section className="admin-design-panel admin-bootstrap-notice">
   <div><h2>Docker Compose: infrastructure only</h2>
    <p>Database URLs, session and encryption secrets, scheduler authentication, proxy networking, storage and persistent backups remain in private deployment configuration. All supported operational product settings live in Master Admin.</p></div>
   <Link href="/admin/settings">Product settings <ArrowRight size={16}/></Link>
  </section>
 </div>;
}
