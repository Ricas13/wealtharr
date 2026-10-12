import Link from "next/link";
import { LayoutDashboard, Layers3, Bell, Settings, Shield, Plus, Sparkles, ClipboardCheck, ArrowUpRight } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WorkspaceNavLink, WorkspaceTabLink } from "@/components/WorkspaceNavigation";

export type TrackingSummary={activeStrategies:number;actionsDue:number};

export function trackingStatusText(summary:TrackingSummary){
  if(summary.activeStrategies<=0)return "No strategies yet";
  const strategies=summary.activeStrategies+(summary.activeStrategies===1?" strategy":" strategies");
  const due=summary.actionsDue<=0?"no actions due":summary.actionsDue+(summary.actionsDue===1?" action due":" actions due");
  return strategies+" · "+due;
}

export function AppShell({ children, isAdmin=false, strategyTabs=[], unreadCount=0, tracking={activeStrategies:strategyTabs.length,actionsDue:0} }: { children:React.ReactNode; isAdmin?:boolean; strategyTabs?:Array<{id:string;name:string}>; unreadCount?:number; tracking?:TrackingSummary }) {
  return <div className="app-shell customer-workspace-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className="sidebar member-sidebar">
      <Link href="/app" className="brand">
        <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5 7 17.5l5-9.5 5 9.5 4.5-11"/><path d="M17 4.5h4.5V9"/></svg></span>
        <span>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}<span className="member-brand-dot">.</span></span>
      </Link>
      <nav className="nav-group" aria-label="Primary">
        <div className="nav-label">Workspace</div>
        <WorkspaceNavLink href="/app"><LayoutDashboard size={17}/>Overview</WorkspaceNavLink>
        <WorkspaceNavLink href="/app/strategies"><Layers3 size={17}/>My strategies</WorkspaceNavLink>
        <Link className="nav-link member-queue-nav" href="/app#action-queue"><ClipboardCheck size={17}/>Action queue{tracking.actionsDue>0&&<span className="nav-badge">{tracking.actionsDue>99?"99+":tracking.actionsDue}</span>}</Link>
        <WorkspaceNavLink href="/app/explore"><Sparkles size={17}/>Explore strategies</WorkspaceNavLink>
        <div className="member-nav-separator" aria-hidden="true"/>
        <WorkspaceNavLink href="/app/notifications"><Bell size={17}/>Notifications{unreadCount>0&&<><span className="nav-badge" aria-hidden="true">{unreadCount>99?"99+":unreadCount}</span><span className="sr-only"> ({unreadCount} unread)</span></>}</WorkspaceNavLink>
        <WorkspaceNavLink href="/app/settings"><Settings size={17}/>Settings</WorkspaceNavLink>
        {isAdmin&&<Link className="nav-link admin-link" href="/admin"><Shield size={17}/>Admin</Link>}
      </nav>
      <div className="member-sidebar-bottom">
        <Link href="/app/settings" className="member-plan-card"><span>Your membership</span><strong>Keep it organised.</strong><small>Your plan, notification channels and personal settings in one place.</small><span className="member-plan-link">Manage account <ArrowUpRight size={13}/></span></Link>
        <div className="member-sidebar-foot"><span className="member-account-mark" aria-hidden="true">W</span><span><strong>My workspace</strong><small>{trackingStatusText(tracking)}</small></span></div>
      </div>
    </aside>
    <main className="app-main" id="main-content" tabIndex={-1}>
      <div className="app-topbar">
        <div className="member-topbar-breadcrumb"><span>Member workspace</span><span className="member-chevron" aria-hidden="true">›</span><strong>Portfolio</strong></div>
        <div className="topbar-actions">
          <span className="topbar-status"><span className={"status-dot"+(tracking.activeStrategies>0?"":" idle")} aria-hidden="true"/>{trackingStatusText(tracking)}</span>
          <ThemeToggle/>
          <Link href="/app/strategies/new" className="button primary compact"><Plus size={16}/>Add strategy</Link>
        </div>
      </div>
      {strategyTabs.length>0&&<nav className="strategy-tab-nav" aria-label="Your strategy tabs"><WorkspaceTabLink href="/app">Main</WorkspaceTabLink>{strategyTabs.map(strategy=><WorkspaceTabLink key={strategy.id} href={"/app/strategies/"+strategy.id}>{strategy.name}</WorkspaceTabLink>)}</nav>}
      <div className="app-content">{children}</div>
    </main>
  </div>;
}
