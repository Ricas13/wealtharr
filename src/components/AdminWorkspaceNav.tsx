"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {
 LayoutDashboard,UsersRound,Layers3,CreditCard,PlugZap,Activity,
 ShieldCheck,Settings2,ChevronLeft,BookOpen,ArrowUpRight
} from "lucide-react";

const groups=[
 {title:"Workspace",items:[
  {href:"/admin",label:"Overview",Icon:LayoutDashboard},
  {href:"/admin/users",label:"Customers",Icon:UsersRound},
  {href:"/admin/strategies",label:"Strategy Studio",Icon:Layers3},
  {href:"/admin/plans",label:"Commerce",Icon:CreditCard},
  {href:"/admin/integrations",label:"Integrations",Icon:PlugZap},
  {href:"/admin/operations",label:"Operations",Icon:Activity}
 ]},
 {title:"Governance",items:[
  {href:"/admin/security",label:"Security & audit",Icon:ShieldCheck},
  {href:"/admin/settings",label:"Settings",Icon:Settings2}
 ]},
 {title:"Product configuration",items:[
  {href:"/admin/configuration",label:"Setup wizard",Icon:BookOpen},
  {href:"/admin/launch",label:"Launch readiness",Icon:ShieldCheck}
 ]}
] as const;

export function AdminWorkspaceNav(){
 const path=usePathname();
 const active=(href:string)=>href==="/admin"?path==="/admin":
  path===href||(href==="/admin/strategies"&&path.startsWith("/admin/strategies/"));
 return <div className="admin-nav-inner">
  <Link href="/admin" className="admin-workspace-brand" aria-label="Wealtharr Master Admin home">
   <span className="admin-brand-glyph" aria-hidden="true">W</span>
   <span><strong>Wealtharr</strong><small>MASTER ADMIN</small></span>
  </Link>
  <div className="admin-workspace-caption"><span className="admin-sidebar-pulse" aria-hidden="true"/> CONTROL CENTRE</div>
  <nav aria-label="Master Admin navigation" className="admin-workspace-navigation">
   {groups.map(group=><div className="admin-nav-section" key={group.title}>
    <div className="admin-nav-heading">{group.title}</div>
    {group.items.map(({href,label,Icon})=><Link href={href} key={href}
      className={"admin-nav-item"+(active(href)?" is-active":"")}
      aria-current={active(href)?"page":undefined}>
      <Icon size={17} strokeWidth={1.9} aria-hidden="true"/>
      <span>{label}</span>
      {active(href)&&<span className="admin-nav-active-dot" aria-hidden="true"/>}
    </Link>)}
   </div>)}
  </nav>
  <div className="admin-nav-footer">
   <Link href="/app"><ChevronLeft size={15} aria-hidden="true"/> Return to customer app</Link>
   <a href="/admin/seo">Site & branding <ArrowUpRight size={13} aria-hidden="true"/></a>
   <small>Operational access · Admin only</small>
  </div>
 </div>;
}
