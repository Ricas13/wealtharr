import Link from "next/link";
import { LayoutDashboard, Layers3, Bell, Settings, Shield, Plus, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WorkspaceNavLink, WorkspaceTabLink } from "@/components/WorkspaceNavigation";

export function AppShell({ children, isAdmin=false, strategyTabs=[], unreadCount=0 }: { children:React.ReactNode; isAdmin?:boolean; strategyTabs?:Array<{id:string;name:string}>; unreadCount?:number }) {
  return <div className="app-shell customer-workspace-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar">
      <Link href="/app" className="brand"><span className="brand-mark" aria-hidden="true"/><span>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</span></Link>
      <nav className="nav-group" aria-label="Primary">
        <div className="nav-label">Your money</div>
        <WorkspaceNavLink href="/app"><LayoutDashboard size={17}/>Main</WorkspaceNavLink>
        <WorkspaceNavLink href="/app/strategies"><Layers3 size={17}/>Strategies</WorkspaceNavLink>
        <WorkspaceNavLink href="/app/notifications"><Bell size={17}/>Notifications{unreadCount>0&&<><span className="nav-badge" aria-hidden="true">{unreadCount>99?"99+":unreadCount}</span><span className="sr-only"> ({unreadCount} unread)</span></>}</WorkspaceNavLink>
        <WorkspaceNavLink href="/app/explore"><Sparkles size={17}/>Explore</WorkspaceNavLink>
        <WorkspaceNavLink href="/app/settings"><Settings size={17}/>Settings</WorkspaceNavLink>
        {isAdmin && <Link className="nav-link admin-link" href="/admin"><Shield size={17}/>Admin</Link>}
      </nav>
    </aside>
    <main className="app-main" id="main-content" tabIndex={-1}>
      <div className="app-topbar">
        <div className="topbar-status"><span className="status-dot"/>Your strategies are being tracked</div>
        <div className="topbar-actions"><ThemeToggle/><Link href="/app/strategies/new" className="button primary compact"><Plus size={16}/>Add strategy</Link></div>
      </div>
      {strategyTabs.length>0&&<nav className="strategy-tab-nav" aria-label="Your strategy tabs"><WorkspaceTabLink href="/app">Main</WorkspaceTabLink>{strategyTabs.map(strategy=><WorkspaceTabLink key={strategy.id} href={"/app/strategies/"+strategy.id}>{strategy.name}</WorkspaceTabLink>)}</nav>}
      <div className="app-content">{children}</div>
    </main>
  </div>;
}
