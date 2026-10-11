import Link from "next/link";
import { LayoutDashboard, Layers3, Bell, Settings, Shield, Plus, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppShell({ children, isAdmin=false, strategyTabs=[] }: { children:React.ReactNode; isAdmin?:boolean; strategyTabs?:Array<{id:string;name:string}> }) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar">
      <Link href="/app" className="brand"><span className="brand-mark" aria-hidden="true"/><span>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</span></Link>
      <nav className="nav-group" aria-label="Primary">
        <div className="nav-label">Your money</div>
        <Link className="nav-link" href="/app"><LayoutDashboard size={17}/>Main</Link>
        <Link className="nav-link" href="/app/strategies"><Layers3 size={17}/>Strategies</Link>
        <Link className="nav-link" href="/app/notifications"><Bell size={17}/>Notifications</Link>
        <Link className="nav-link" href="/app/community"><Sparkles size={17}/>Explore</Link>
        <Link className="nav-link" href="/app/settings"><Settings size={17}/>Settings</Link>
        {isAdmin && <Link className="nav-link admin-link" href="/admin"><Shield size={17}/>Admin</Link>}
      </nav>
    </aside>
    <main className="app-main" id="main-content" tabIndex={-1}>
      <div className="app-topbar">
        <div className="topbar-status"><span className="status-dot"/>Your strategies are being tracked</div>
        <div className="topbar-actions"><ThemeToggle/><Link href="/app/strategies/new" className="button primary compact"><Plus size={16}/>Add strategy</Link></div>
      </div>
      {strategyTabs.length>0&&<nav className="strategy-tab-nav" aria-label="Your strategy tabs"><Link href="/app" className="strategy-tab-link">Main</Link>{strategyTabs.map(strategy=><Link key={strategy.id} href={"/app/strategies/"+strategy.id} className="strategy-tab-link">{strategy.name}</Link>)}</nav>}
      <div className="app-content">{children}</div>
    </main>
  </div>;
}
