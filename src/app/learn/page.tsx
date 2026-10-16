import Link from "next/link";
import type {Metadata} from "next";
import {learningGuides} from "@/components/LearningGuide";
import {safeJsonLd,siteOrigin} from "@/lib/public-seo";

export const metadata:Metadata={
 title:"Portfolio Rebalancing and ETF Research Guides",
 description:"Clear, practical guides to portfolio rebalancing, UK ISA instrument tracking and leveraged ETP risk for self-directed investors.",
 alternates:{canonical:"/learn"},
 openGraph:{title:"Portfolio Rebalancing and ETF Research Guides",url:"/learn",
  description:"Understand the maths and risks behind self-directed portfolio tracking."}
};
export default function LearnPage(){
 const origin=siteOrigin(process.env.NEXT_PUBLIC_APP_URL);
 const schema={"@context":"https://schema.org","@type":"CollectionPage",
  name:"Portfolio research guides",url:new URL("/learn",origin).toString(),
  hasPart:learningGuides.map(g=>({"@type":"WebPage",name:g.title,url:new URL(g.path,origin).toString()}))};
 return <main className="container">
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(schema)}}/>
  <nav className="public-nav"><Link className="brand" href="/">Wealtharr</Link><Link href="/tools/rebalance-calculator">Free calculator</Link></nav>
  <section className="section">
   <div className="eyebrow">Learn the rules</div><h1>Portfolio research and rebalancing guides</h1>
   <p>Original educational guides with transparent calculations, examples and limitations. Understand a method before deciding whether to use it. These guides do not recommend particular investments.</p>
   <div className="cards" style={{marginTop:24}}>
    {learningGuides.map(g=><article className="card" key={g.path}><h2>{g.title}</h2><p>{g.description}</p><Link href={g.path}>Read guide →</Link></article>)}
   </div>
  </section>
  <section className="section"><h2>Calculate a sample rebalancing amount</h2>
   <p>Practise target-weight arithmetic with your own illustrative numbers. No account or brokerage connection is required.</p>
   <Link className="button primary" href="/tools/rebalance-calculator">Try the free calculator</Link>
  </section>
  <footer className="footer"><Link href="/">Home</Link> · <Link href="/features">Features</Link> · <Link href="/faq">FAQ</Link> · <Link href="/research-disclaimer">Research disclaimer</Link></footer>
 </main>;
}
