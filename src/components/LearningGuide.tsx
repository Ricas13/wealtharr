import Link from "next/link";
import type {ReactNode} from "react";
import {safeJsonLd,siteOrigin} from "@/lib/public-seo";

export const learningGuides=[
 {path:"/learn/portfolio-rebalancing",title:"How portfolio rebalancing calculations work",
  description:"Work through a transparent 60/40 allocation example, including cash, real trade fills and practical rounding."},
 {path:"/learn/uk-isa-portfolio-tracking",title:"Tracking ETFs and ETPs in a UK Stocks and Shares ISA",
  description:"A checklist for verifying investment identifiers, UK listings, dealing currency and recorded contributions."},
 {path:"/learn/leveraged-etp-risks",title:"Why daily-reset leveraged ETP returns can surprise investors",
  description:"Learn how multi-day compounding, volatility and financing costs affect leveraged exposure."}
] as const;
type Props={title:string;description:string;path:string;children:ReactNode};
export function LearningGuide({title,description,path,children}:Props){
 const origin=siteOrigin(process.env.NEXT_PUBLIC_APP_URL).toString();
 const url=new URL(path,origin).toString();
 const schema={"@context":"https://schema.org","@graph":[
   {"@type":"Article",headline:title,description,inLanguage:"en-GB",datePublished:"2026-10-16",
    mainEntityOfPage:url,author:{"@type":"Organization",name:"Wealtharr"},
    publisher:{"@type":"Organization",name:"Wealtharr"}},
   {"@type":"BreadcrumbList",itemListElement:[
     {"@type":"ListItem",position:1,name:"Home",item:origin},
     {"@type":"ListItem",position:2,name:"Learning guides",item:new URL("/learn",origin).toString()},
     {"@type":"ListItem",position:3,name:title,item:url}
   ]}
 ]};
 return <main className="container">
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(schema)}}/>
  <nav className="public-nav" aria-label="Public pages"><Link className="brand" href="/">Wealtharr</Link><Link href="/tools/rebalance-calculator">Free calculator</Link></nav>
  <div className="section">
   <nav aria-label="Breadcrumb"><Link href="/">Home</Link> / <Link href="/learn">Learning guides</Link></nav>
   <article className="research-document" style={{marginTop:24}}>
    <div className="eyebrow">Portfolio research guide · 16 October 2026</div>
    <h1>{title}</h1><p className="help">{description}</p>
    {children}
   </article>
   <section className="section" aria-label="Further learning"><h2>Keep learning</h2>
    <div className="cards">{learningGuides.filter(g=>g.path!==path).map(g=>
     <article className="card" key={g.path}><h3>{g.title}</h3><p>{g.description}</p><Link href={g.path}>Read guide</Link></article>)}</div>
   </section>
  </div>
  <footer className="footer"><Link href="/learn">Learning library</Link> · <Link href="/features">Features</Link> · <Link href="/research-disclaimer">Research disclaimer</Link></footer>
 </main>;
}
