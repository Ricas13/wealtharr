import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, requirePageUser } from "@/lib/session";
import {AdminWorkspaceNav} from "@/components/AdminWorkspaceNav";

export const dynamic="force-dynamic";

export default async function AdminLayout({children}:{children:React.ReactNode}){
  await requirePageUser();
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof Error && error.message === "MFA_REQUIRED") redirect("/app/settings#security");
    throw error;
  }
  const launchLocked=process.env.WEALTHARR_PAID_LAUNCH_ENABLED!=="true";
  return <div className="app-shell admin-workspace-shell">
    <a className="skip-link" href="#admin-main-content">Skip to main content</a>
    <aside className="sidebar admin-workspace-sidebar"><AdminWorkspaceNav/></aside>
    <main className="app-main admin-workspace-main" id="admin-main-content" tabIndex={-1}>
      <header className="admin-workspace-topbar">
        <div><span className="admin-topbar-kicker">WEALTHARR / ADMIN</span><strong>Control centre</strong></div>
        <div className="admin-topbar-actions">
          <span className={"admin-environment-tag "+(launchLocked?"is-locked":"is-live")}>{launchLocked?"Paid launch locked":"Paid launch enabled"}</span>
          <Link href="/admin/launch" className="admin-topbar-link">Launch review ↗</Link>
        </div>
      </header>
      <div className="app-content admin-workspace-content">{children}</div>
    </main>
  </div>;
}
