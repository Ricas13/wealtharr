import Link from "next/link";
import type {Metadata} from "next";
import {sql} from "@/lib/db";
import {formatMinorCurrency} from "@/domain/currency-money";
export const dynamic="force-dynamic";
export const metadata:Metadata={
 title:"Portfolio Tracker Plans and Pricing",
 description:"Compare free and paid rules-based portfolio tracking plans, with access and limits driven by published plan settings. No hidden or invented plan prices.",
 alternates:{canonical:"/pricing"},
 openGraph:{title:"Portfolio strategy tracker pricing",description:"Compare available plan limits and pricing.",url:"/pricing"}
};
export default async function PricingPage(){
 let rows:any[]=[];
 try{rows=await sql.unsafe("SELECT p.slug,p.display_name,p.billing_currency,p.max_active_strategies,"+
   "CASE WHEN p.slug='free' THEN 0 ELSE monthly.amount_minor END AS monthly_price_minor,"+
   "CASE WHEN p.slug='free' THEN 0 ELSE annual.amount_minor END AS annual_price_minor "+
   "FROM plans p LEFT JOIN plan_prices monthly ON monthly.plan_id=p.id AND monthly.currency=p.billing_currency AND monthly.cadence='MONTHLY' AND monthly.active=true "+
   "LEFT JOIN plan_prices annual ON annual.plan_id=p.id AND annual.currency=p.billing_currency AND annual.cadence='ANNUAL' AND annual.active=true "+
   "WHERE p.visible=true AND p.archived=false ORDER BY p.sort_order");}catch{/* unavailable prices are not invented */}
 return <main><div className="container"><nav className="public-nav"><Link className="brand" href="/">{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link><Link className="button" href="/login">Sign in</Link></nav>
 <section className="section"><div className="eyebrow">Plans and billing</div><h1>Start simple. Add strategies as you need them.</h1><p>Plans define strategy limits and available notification channels. Subscription terms and prices shown below come from the platform&apos;s configured product catalogue.</p>
 <div className="pricing" style={{marginTop:24}}>{rows.length?rows.map(row=><article className="glass price" key={row.slug}>
 <h2>{row.display_name}</h2>{row.monthly_price_minor==null?<p className="help">Currently unavailable for new monthly subscriptions.</p>:<strong>{formatMinorCurrency(Number(row.monthly_price_minor),String(row.billing_currency))}<span style={{fontSize:14}}>/mo</span></strong>}
 <p>{row.max_active_strategies==null?"Unlimited active strategies":String(row.max_active_strategies)+" active strategies"}</p>
 <p className="help">{row.annual_price_minor==null?"Annual option not currently available.":"Annual option: "+formatMinorCurrency(Number(row.annual_price_minor),String(row.billing_currency))+" per year."} Final checkout verifies the amount against Stripe.</p>
 <Link className="button primary" href="/register">Choose plan</Link></article>):<div className="empty" style={{gridColumn:"1/-1"}}>Current plan prices are unavailable. We won&apos;t invent a price or accept a misleading comparison.</div>}</div></section>
 <section className="section"><h2>What does a subscription provide?</h2><p>Strategy tracking and configuration access depend on your selected plan. Brokerage costs, instrument fees, and any external market-data costs are separate unless explicitly stated at checkout.</p><Link href="/faq" className="button">Pricing questions</Link></section>
 <footer className="footer"><Link href="/">Home</Link> · <Link href="/features">Features</Link> · <Link href="/strategies">Strategies</Link></footer></div></main>;
}
