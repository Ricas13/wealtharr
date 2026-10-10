import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin, requirePageUser } from "@/lib/session";

export const dynamic="force-dynamic";

export default async function AdminLayout({children}:{children:React.ReactNode}){
  await requirePageUser();
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof Error && error.message === "MFA_REQUIRED") redirect("/app/settings#security");
    throw error;
  }
  return <div className="app-shell">
    <a className="skip-link" href="#admin-main-content">Skip to main content</a>
    <aside className="sidebar">
      <Link href="/admin" className="brand"><span className="brand-mark" aria-hidden="true"/>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"} Admin</Link>
      <nav className="nav-group" aria-label="Admin">
        <div className="nav-label">Control plane</div>
        <Link className="nav-link" href="/admin">System</Link>
        <Link className="nav-link" href="/admin/configuration">Master setup</Link>
        <Link className="nav-link" href="/admin/settings">Settings</Link>
        <Link className="nav-link" href="/admin/launch">Launch readiness</Link>
        <Link className="nav-link" href="/admin/seo">SEO &amp; brand</Link>
        <Link className="nav-link" href="/admin/operations">Integrations &amp; jobs</Link>
        <Link className="nav-link" href="/admin/plans">Plans</Link>
        <Link className="nav-link" href="/admin/strategies">Strategies</Link>
        <Link className="nav-link" href="/admin/strategies/research">Research catalog</Link>
        <Link className="nav-link" href="/admin/instruments">Instruments</Link>
        <Link className="nav-link" href="/admin/users">Users</Link>
        <Link className="nav-link" href="/app">Customer app</Link>
      </nav>
    </aside>
    <main className="app-main" id="admin-main-content" tabIndex={-1}><div className="app-content">{children}</div></main>
  </div>;
}
