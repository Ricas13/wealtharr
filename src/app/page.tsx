import Link from "next/link";
import type {Metadata} from "next";
import {headers} from "next/headers";
import {currencyForVisitorCountry,type LandingCurrency} from "@/domain/visitor-currency";
import {sql} from "@/lib/db";
import {safeJsonLd,siteOrigin} from "@/lib/public-seo";
import {exactPriceString} from "@/domain/currency-money";
import {canAdvertisePaidOffer} from "@/domain/public-offer-readiness";
import {ensureSettings} from "@/lib/settings";
import {LandingCurrencyProvider,PublicPricingCards,type PublicPlanCard} from "@/components/PublicLandingInteractivity";
import {PublicStrategyComparison} from "@/components/PublicStrategyComparison";
import {loadPublicComparison} from "@/lib/public-strategy-performance";
import "./marketing-home.css";
import "./marketing-simple.css";

export const dynamic="force-dynamic";
export const metadata:Metadata={alternates:{canonical:"/"}};
type PlanRow={slug:string;display_name:string;description:string|null;billing_currency:string;max_active_strategies:number|null;entitlements:unknown;homepage_highlights:unknown;monthly_price_minor:number|null;annual_price_minor:number|null;prices:unknown};
function decodeEntitlements(raw:unknown):{features:string[];notificationChannels:string[]}{
  let parsed=raw;
  if(typeof raw==="string"){try{parsed=JSON.parse(raw);}catch{return {features:[],notificationChannels:[]};}}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return {features:[],notificationChannels:[]};
  const obj=parsed as Record<string,unknown>;
  return {features:Array.isArray(obj.features)?obj.features.filter((x):x is string=>typeof x==="string"):[],
    notificationChannels:Array.isArray(obj.notificationChannels)?obj.notificationChannels.filter((x):x is string=>typeof x==="string"):[]};
}
function planCurrencyPrices(raw:unknown):PublicPlanCard["prices"]{
 const currencies:PublicPlanCard["prices"]={};
 if(!Array.isArray(raw))return currencies;
 for(const item of raw){
  if(!item||typeof item!=="object")continue;
  const price=item as {currency?:unknown;cadence?:unknown;amountMinor?:unknown};
  if(price.currency!=="GBP"&&price.currency!=="EUR"&&price.currency!=="USD")continue;
  const amount=Number(price.amountMinor);
  if(!Number.isSafeInteger(amount)||amount<0)continue;
  const unit:LandingCurrency=price.currency;
  const previous=currencies[unit]??{monthly:null,annual:null};
  if(price.cadence==="MONTHLY")currencies[unit]={...previous,monthly:amount};
  if(price.cadence==="ANNUAL")currencies[unit]={...previous,annual:amount};
 }
 return currencies;
}
async function loadPublicPlans():Promise<PublicPlanCard[]>{
  let rows:PlanRow[]=[];
  try{
    rows=await sql.unsafe(
      "SELECT p.slug,p.display_name,p.description,p.billing_currency,p.max_active_strategies,p.entitlements,p.homepage_highlights,"+
      "(SELECT jsonb_agg(jsonb_build_object('currency',pp.currency,'cadence',pp.cadence,'amountMinor',pp.amount_minor)) FROM plan_prices pp WHERE pp.plan_id=p.id AND pp.active=true AND pp.currency IN ('GBP','EUR','USD')) AS prices,"+
      "CASE WHEN p.slug='free' THEN 0 ELSE mo.amount_minor END AS monthly_price_minor,"+
      "CASE WHEN p.slug='free' THEN 0 ELSE yr.amount_minor END AS annual_price_minor "+
      "FROM plans p "+
      "LEFT JOIN plan_prices mo ON mo.plan_id=p.id AND mo.currency=p.billing_currency AND mo.cadence='MONTHLY' AND mo.active=true "+
      "LEFT JOIN plan_prices yr ON yr.plan_id=p.id AND yr.currency=p.billing_currency AND yr.cadence='ANNUAL' AND yr.active=true "+
      "WHERE p.visible=true AND p.archived=false AND (p.slug='free' OR mo.amount_minor IS NOT NULL OR yr.amount_minor IS NOT NULL) "+
      "ORDER BY p.sort_order,p.slug LIMIT 5"
    ) as PlanRow[];
  }catch{/* No invented plans/prices when billing data are unavailable. */}
  return rows.filter(row=>/^[A-Z]{3}$/.test(String(row.billing_currency))&&
      (row.monthly_price_minor!==null||row.annual_price_minor!==null))
    .map(row=>{
      const ent=decodeEntitlements(row.entitlements);
      return {slug:String(row.slug),name:String(row.display_name),description:String(row.description??""),
        currency:String(row.billing_currency),monthlyMinor:row.monthly_price_minor===null?null:Number(row.monthly_price_minor),
        annualMinor:row.annual_price_minor===null?null:Number(row.annual_price_minor),
        maxActive:row.max_active_strategies===null?null:Number(row.max_active_strategies),
        features:ent.features,channels:ent.notificationChannels,
        highlights:Array.isArray(row.homepage_highlights)?row.homepage_highlights.filter((v):v is string=>typeof v==="string"):[],
        prices:planCurrencyPrices(row.prices)};
    });
}
export default async function HomePage(){
  await ensureSettings();
  const [plans,comparison]=await Promise.all([loadPublicPlans(),loadPublicComparison()]);
  const geoHeaders=await headers();
  const visitorCurrency=currencyForVisitorCountry(geoHeaders.get("cf-ipcountry")??geoHeaders.get("x-vercel-ip-country"));
  const brand=process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr";
  const origin=siteOrigin(process.env.NEXT_PUBLIC_APP_URL).toString();
  const offered=canAdvertisePaidOffer(process.env)?plans.find(plan=>plan.monthlyMinor!==null&&plan.monthlyMinor>0):undefined;
  const offer=offered?{offers:{"@type":"Offer",price:exactPriceString(offered.monthlyMinor!,offered.currency),priceCurrency:offered.currency}}:{};
  const schema={"@context":"https://schema.org","@graph":[
    {"@type":"Organization","@id":origin+"#publisher",name:brand,url:origin,
      description:"Self-directed portfolio research and strategy-tracking software."},
    {"@type":"WebSite","@id":origin+"#website",name:brand,url:origin,
      publisher:{"@id":origin+"#publisher"},inLanguage:"en-GB"},
    {"@type":"SoftwareApplication","@id":origin+"#application",name:brand,applicationCategory:"FinanceApplication",
      operatingSystem:"Web",url:origin,publisher:{"@id":origin+"#publisher"},
      description:"Compare evidence-backed historical strategy models and track your own portfolio reviews. No trades are placed.",...offer}
  ]};
  return <LandingCurrencyProvider initialCurrency={visitorCurrency}><main className="wealtharr-marketing wm-simple" id="top">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(schema)}}/>
    <header className="wm-header"><nav className="wm-shell wm-nav" aria-label="Primary navigation">
      <Link href="/" className="wm-brand"><span className="wm-mark" aria-hidden="true">⌁</span>{brand.toLowerCase()}<span className="wm-brand-dot">.</span></Link>
      <div className="wm-nav-links"><a href="#compare">Compare strategies</a><a href="#pricing">Plans</a></div>
      <div className="wm-nav-actions"><Link href="/login" className="wm-signin">Sign in</Link><Link href="/register" className="wm-button main">Get started ↗</Link></div>
      <details className="wm-mobile-menu"><summary aria-label="Open menu">☰</summary>
        <div><a href="#compare">Compare strategies</a><a href="#pricing">Plans</a><Link href="/login">Sign in</Link><Link href="/register">Get started</Link></div>
      </details>
    </nav></header>
    <section className="wm-shell wm-simple-hero" aria-labelledby="wm-headline">
      <span className="wm-kicker">YOUR MONEY · YOUR PLAN · CLEARER DECISIONS</span>
      <h1 id="wm-headline">Invest your money, <em>guided by the most popular strategies.</em></h1>
      <p>Explore widely followed investment approaches, compare documented model performance with SPY buy-and-hold, then track the strategy you choose. Your money stays with your broker.</p>
      <div className="wm-simple-actions">
        <a href="#compare" className="wm-button main">Compare strategies ↘</a>
        <Link href="/register" className="wm-button outline">Start tracking ↗</Link>
      </div>
      <p className="wm-simple-trust">Browse freely · No automatic trades · Historical models are not forecasts</p>
    </section>
    <section className="wm-section wm-shell wm-simple-comparison" id="compare" aria-labelledby="wm-compare-title">
      <span className="wm-kicker">DISCOVER &amp; COMPARE</span>
      <h2 id="wm-compare-title">See how the strategies <em>have performed.</em></h2>
      <p className="wm-section-intro">Turn individual methods on or off and compare their historical model returns with SPY on matched dates. We show only properly documented, published return histories—never invented performance figures.</p>
      <PublicStrategyComparison entries={comparison.entries} spy={comparison.spy} asOf={comparison.asOf} spySource={comparison.spySource}/>
    </section>
    <section className="wm-section wm-pricing-section" id="pricing" aria-labelledby="wm-plans-heading">
      <div className="wm-shell"><div className="wm-centered">
        <span className="wm-kicker">SIMPLE PLANS</span>
        <h2 id="wm-plans-heading">Choose how you want <em>to track.</em></h2>
        <p className="wm-section-intro">Your strategy, your broker, your decisions. Prices and plan benefits come directly from published Wealtharr administrator settings.</p>
      </div>
      <PublicPricingCards plans={plans}/>
      <p className="wm-note wm-centered">Availability and final billing are confirmed at sign-up. Brokerage and fund costs are separate.</p>
      </div>
    </section>
    <footer className="wm-footer"><div className="wm-shell">
      <strong>{brand.toLowerCase()}.</strong>
      <div><Link href="/strategies">Methodology</Link><Link href="/learn">Learning guides</Link><Link href="/faq">FAQ</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/research-disclaimer">Risk &amp; research disclosures</Link></div>
      <p>Independent rules-based research and portfolio tracking. Wealtharr is not a brokerage or personal investment adviser. Investing can result in loss of capital. Past performance is not a reliable indicator of future results. Availability of strategies and financial instruments depends on your account and region.</p>
    </div></footer>
  </main></LandingCurrencyProvider>;
}
