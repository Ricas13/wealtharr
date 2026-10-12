import Link from "next/link";
import {requireAdminPage} from "@/lib/session";
import {publicIndexingEnabled,publicSeoRoutes,siteOrigin} from "@/lib/public-seo";
export const dynamic="force-dynamic";
export default async function SeoAdminPage(){
 await requireAdminPage();
 const origin=siteOrigin(process.env.NEXT_PUBLIC_APP_URL);
 const indexing=publicIndexingEnabled(process.env);
 const brand=process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr";
 const checks=[
  ["Public HTTPS origin",origin.protocol==="https:","Set the public web address to your production HTTPS domain in Admin › Settings › General."],
  ["Search indexing authorised",indexing,"Turn on search indexing in Admin › Settings › General only after customer and public-site release gates pass."],
  ["Google Search Console verification",Boolean(process.env.GOOGLE_SITE_VERIFICATION),"Enter the Search Console token in Admin › Settings › General after verifying your domain."],
  ["Brand reviewed",process.env.BRAND_CLEARANCE_VERIFIED==="true","Confirm trade mark, company and domain clearance before claiming the name."],
  ["Public terms and privacy",process.env.LEGAL_PUBLIC_PAGES_VERIFIED==="true","Publish accurate business identity, privacy policy, support and subscription terms after review."]
 ];
 return <><div className="page-title"><div><div className="eyebrow">Admin · Growth</div><h1>Search visibility and SEO</h1><p>Review public discoverability without exposing accounts or enabling indexing by accident.</p></div></div>
 <div className="admin-grid">
  <div className="glass metric"><small>Current brand</small><strong style={{fontSize:21}}>{brand}</strong></div>
  <div className="glass metric"><small>Search crawlers</small><strong style={{fontSize:21}}>{indexing?"Indexing allowed":"Indexing blocked"}</strong></div>
  <div className="glass metric"><small>Canonical origin</small><strong style={{fontSize:13,overflowWrap:"anywhere"}}>{origin.hostname}</strong></div>
 </div>
 <section className="card" style={{marginTop:18}}><h2>Public-site checklist</h2>
  {checks.map(([title,ok,instruction])=><div className="why-row" key={String(title)}>
   <span><strong>{ok?"✓":"○"} {title}</strong><p className="help">{instruction}</p></span><b>{ok?"Ready":"Action required"}</b>
  </div>)}
  <p className="help">These are configuration declarations, not proof of a successful Google crawl, domain ownership or trademark clearance.</p>
 </section>
 <div className="detail-grid" style={{marginTop:18}}><section className="card"><h3>Public SEO pages</h3>
  {publicSeoRoutes.map(path=><div className="why-row" key={path}><Link href={path}>{path}</Link><span>Canonical page</span></div>)}
  <p className="help">Only these pages belong in the sitemap. App, admin, login, signup and API paths are protected from indexing.</p></section>
 <section className="card"><h3>Technical checks</h3>
  <p><a href={new URL("/robots.txt",origin).toString()} target="_blank" rel="noopener noreferrer">robots.txt</a> · <a href={new URL("/sitemap.xml",origin).toString()} target="_blank" rel="noopener noreferrer">sitemap.xml</a></p>
  <p><a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Google Search Console</a> · <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer">Google Rich Results Test</a></p>
  <p className="help">After launch, submit your sitemap and inspect indexed URLs, Core Web Vitals, and real search traffic. Ranking is never guaranteed.</p>
 </section></div>
 <section className="card" style={{marginTop:18}}><h3>Operator guide</h3><p>Configure branding and SEO via your protected Oracle deployment settings. See <code>docs/COMMERCIAL_SEO_LAUNCH.md</code> for keyword/content research, legal gates and checks before turning on public indexing.</p></section></>;
}
