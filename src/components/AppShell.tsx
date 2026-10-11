import Link from "next/link";
import {Plus, ChevronDown} from "lucide-react";
import {ThemeToggle} from "@/components/ThemeToggle";
import {PortfolioNavigation} from "@/components/PortfolioNavigation";

export function AppShell({children,isAdmin=false,strategyTabs=[]}:{children:React.ReactNode;isAdmin?:boolean;strategyTabs?:Array<{id:string;name:string}>}){
 return <div className="app-shell portfolio-shell">
  <a className="skip-link" href="#main-content">Skip to main content</a>
  <header className="portfolio-app-header">
   <div className="portfolio-app-header-inner">
    <Link href="/app" className="portfolio-app-brand"><span className="portfolio-logo-glyph" aria-hidden="true">W</span><span>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</span></Link>
    <PortfolioNavigation isAdmin={isAdmin}/>
    <div className="portfolio-app-actions">
     <ThemeToggle/>
     <Link href="/app/strategies/new" className="button primary compact portfolio-add-button"><Plus size={16} aria-hidden="true"/><span>Add strategy</span></Link>
    </div>
   </div>
  </header>
  <div className="portfolio-subbar"><div className="portfolio-subbar-inner">
   <span className="portfolio-subbar-caption">WORKSPACE</span>
   <nav className="portfolio-tabs" aria-label="Your strategy tabs">
    <Link className="portfolio-tab-overview" href="/app">All strategies</Link>
    {strategyTabs.map(strategy=><Link key={strategy.id} href={"/app/strategies/"+strategy.id} className="portfolio-tab-item">{strategy.name}</Link>)}
   </nav>
   <Link href="/app/strategies" className="portfolio-subbar-manage">Manage <ChevronDown size={13} aria-hidden="true"/></Link>
  </div></div>
  <main className="app-main portfolio-app-main" id="main-content" tabIndex={-1}>
   <div className="app-content portfolio-content">{children}</div>
  </main>
 </div>;
}
