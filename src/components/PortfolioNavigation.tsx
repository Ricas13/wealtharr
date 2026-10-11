"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {LayoutDashboard, Layers3, Bell, Settings2, Compass, ShieldCheck} from "lucide-react";

export function PortfolioNavigation({isAdmin}:{isAdmin:boolean}){
 const pathname=usePathname();
 const links=[
  {href:"/app",label:"Dashboard",icon:LayoutDashboard},
  {href:"/app/strategies",label:"Portfolio",icon:Layers3},
  {href:"/app/notifications",label:"Activity",icon:Bell},
  {href:"/app/community",label:"Explore",icon:Compass},
  {href:"/app/settings",label:"Settings",icon:Settings2}
 ];
 return <nav className="portfolio-primary-navigation" aria-label="Primary">
  {links.map(({href,label,icon:Icon})=>{
    const active=href==="/app"?pathname==="/app":pathname===href||pathname.startsWith(href+"/");
    return <Link key={href} href={href} className={"portfolio-primary-link"+(active?" is-current":"")} aria-current={active?"page":undefined}><Icon size={16} aria-hidden="true"/><span>{label}</span></Link>;
  })}
  {isAdmin&&<Link href="/admin" className="portfolio-primary-link portfolio-admin-link"><ShieldCheck size={16} aria-hidden="true"/><span>Admin</span></Link>}
 </nav>;
}
