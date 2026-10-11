import Link from "next/link";
import {redirect} from "next/navigation";
import {Bell,Settings2,UserRound} from "lucide-react";
import {requireAdmin,requirePageUser} from "@/lib/session";
import {AdminWorkspaceNav} from "@/components/AdminWorkspaceNav";

export const dynamic="force-dynamic";

export default async function AdminLayout({children}:{children:React.ReactNode}){
 await requirePageUser();
 try{
  await requireAdmin();
 }catch(error){
  if(error instanceof Error&&error.message==="MFA_REQUIRED")redirect("/app/settings#security");
  throw error;
 }
 const launchLocked=process.env.WEALTHARR_PAID_LAUNCH_ENABLED!=="true";
 return <div className="app-shell admin-workspace-shell">
  <a href="#admin-main-content" className="skip-link">Skip to main content</a>
  <aside className="sidebar admin-workspace-sidebar"><AdminWorkspaceNav/></aside>
  <main className="app-main admin-workspace-main" aria-label="Wealtharr Master Admin" id="admin-main-content" tabIndex={-1}>
   <header className="admin-workspace-topbar">
    <div className="admin-topbar-identity">
     <span className="admin-topbar-kicker">WEALTHARR / ADMIN</span>
     <strong>Control centre</strong>
    </div>
    <nav aria-label="Quick administration" className="admin-topbar-actions">
     <span className={"admin-environment-tag "+(launchLocked?"is-locked":"is-live")}>{launchLocked?"Pre-launch":"Paid launch enabled"}</span>
     <Link href="/admin/operations" aria-label="Operational notifications" title="Operational notifications" className="admin-icon-link"><Bell size={18}/></Link>
     <Link href="/admin/settings" aria-label="Admin settings" title="Admin settings" className="admin-icon-link"><Settings2 size={18}/></Link>
     <Link href="/admin/security" aria-label="Security and audit" title="Security and audit" className="admin-topbar-avatar"><UserRound size={17}/></Link>
    </nav>
   </header>
   <div className="app-content admin-workspace-content">{children}</div>
  </main>
 </div>;
}
