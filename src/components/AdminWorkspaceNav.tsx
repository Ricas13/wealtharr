"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";

const sections = [
  {title:"Workspace",items:[
    {href:"/admin",label:"Overview",mark:"◫"},
    {href:"/admin/configuration",label:"Setup guide",mark:"◇"}
  ]},
  {title:"Product",items:[
    {href:"/admin/strategies",label:"Strategies",mark:"▤"},
    {href:"/admin/strategies/research",label:"Research library",mark:"◈"},
    {href:"/admin/instruments",label:"Instruments",mark:"◎"},
    {href:"/admin/plans",label:"Plans & pricing",mark:"≡"},
    {href:"/admin/users",label:"Customers",mark:"♙"}
  ]},
  {title:"Operations",items:[
    {href:"/admin/operations",label:"Jobs & providers",mark:"◷"},
    {href:"/admin/settings",label:"Settings",mark:"⚙"}
  ]},
  {title:"Governance",items:[
    {href:"/admin/launch",label:"Launch checks",mark:"✓"},
    {href:"/admin/seo",label:"SEO & brand",mark:"↗"}
  ]}
] as const;

export function AdminWorkspaceNav(){
  const path=usePathname();
  return <div className="admin-nav-inner">
    <Link href="/admin" className="admin-workspace-brand"><span className="admin-brand-glyph" aria-hidden="true">W</span><span><strong>Wealtharr</strong><small>Master administration</small></span></Link>
    <div className="admin-workspace-caption">CONTROL CENTRE <span>·</span> PRIVATE</div>
    <nav className="admin-workspace-navigation" aria-label="Master Admin navigation">
      {sections.map(section=><div className="admin-nav-section" key={section.title}>
        <div className="admin-nav-heading">{section.title}</div>
        {section.items.map(item=>{
          const active=path===item.href || (item.href!=="/admin" && item.href!=="/admin/strategies" && path.startsWith(item.href+"/"));
          return <Link key={item.href} href={item.href} aria-current={active?"page":undefined} className={"admin-nav-item"+(active?" is-active":"")}>
            <span className="admin-nav-symbol" aria-hidden="true">{item.mark}</span>{item.label}{active&&<span className="admin-nav-active-dot" aria-hidden="true"/>}
          </Link>;
        })}
      </div>)}
    </nav>
    <div className="admin-nav-footer"><Link href="/app">← Return to customer app</Link><small>Operational access · Admin only</small></div>
  </div>;
}
