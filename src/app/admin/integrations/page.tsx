import Link from "next/link";
import {requireAdminPage} from "@/lib/session";
import {CreditCard,ChartNoAxesCombined,Mail,Clock3,Landmark,ArrowRight,PlugZap,ShieldCheck,ShieldAlert} from "lucide-react";
import {ensureSettings} from "@/lib/settings";
import {listSettings} from "@/lib/settings";
import {describeIntegrationStatuses} from "@/domain/admin-integration-status";

export const dynamic="force-dynamic";

export default async function IntegrationsPage(){
 await requireAdminPage();
 await ensureSettings(true);
 const settings=await listSettings();
 const status=describeIntegrationStatuses(settings);
 const categories=[
  {title:"Cloudflare Turnstile",detail:"Protect registration, password login and password-reset requests",Icon:ShieldAlert,href:"/admin/settings#settings-cloudflare-turnstile",status:status.turnstile,note:"Save both keys, complete the live challenge test in Admin Settings, and enable the protection switch. Saved keys alone do not mean protection is active."},
  {title:"Brokerage",detail:"Trading 212 and future strategy-scoped read-only providers",Icon:Landmark,href:"/admin/strategies",status:"Planned",note:"Strategy-specific connection only. Unrelated holdings are ignored. No brokerage connection has been implemented."},
  {title:"Market data",detail:"Live quotes, validated historical prices and source licensing",Icon:ChartNoAxesCombined,href:"/admin/settings#settings-market-data",status:status.marketData,note:"Manual mode needs user-entered prices. Yahoo is unofficial and unsuitable for paid redistribution. Saved credentials do not prove source freshness, coverage or licences."},
  {title:"Payments",detail:"Stripe billing, subscription plans and webhooks",Icon:CreditCard,href:"/admin/settings#settings-billing-stripe-",status:status.payments,note:"Real checkout and webhook verification remain separate launch gates."},
  {title:"Communications",detail:"Email, Discord and Telegram notifications",Icon:Mail,href:"/admin/settings#settings-email",status:status.communications,note:"Status reflects email configuration only, not Discord or Telegram. Use Operations to test actual delivery and inspect retries."},
  {title:"Automation",detail:"Scheduled calculations, provider health and retry queues",Icon:Clock3,href:"/admin/operations",status:"Inspect health",note:"Worker runs are recorded individually. A schedule is not proof of successful execution."}
 ];
 return <div className="admin-integration-hub">
  <div className="admin-design-heading"><div><span className="admin-kicker">WORKSPACE / INTEGRATIONS</span><h1>Integrations</h1><p>Connect the services powering Wealtharr, without technical clutter.</p></div>
   <Link className="admin-design-button" href="/admin/settings"><PlugZap size={16}/> Manage settings</Link></div>
  <section className="admin-design-panel admin-integration-panel" aria-labelledby="integration-list-title">
   <header className="admin-design-panel-header"><div><h2 id="integration-list-title">Available providers</h2><p>Centralised configuration and setup status (not live provider verification)</p></div></header>
   {categories.map(({title,detail,Icon,href,status,note})=><div className="admin-integration-row" key={title}>
    <div className="admin-integration-icon"><Icon size={21} aria-hidden="true"/></div>
    <div className="admin-integration-description"><h3>{title}</h3><p>{detail}</p><small>{note}</small></div>
    <span className="admin-integration-status">{status}</span>
    <Link href={href} aria-label={"Open "+title+" settings"} className="admin-integration-action"><ArrowRight size={18}/></Link>
   </div>)}
  </section>
  <section className="admin-design-quick-links">
   <div><h2>Operational verification</h2><p>Configured does not mean connected or independently approved.</p></div>
   <div><Link href="/admin/operations"><ShieldCheck size={16}/> Run connection checks</Link>
    <Link href="/admin/launch">Launch review <ArrowRight size={16}/></Link></div>
  </section>
 </div>;
}
