import Link from "next/link";
import type {Metadata} from "next";
import {headers} from "next/headers";
import {currencyForVisitorCountry,type LandingCurrency} from "@/domain/visitor-currency";
import {HeroStrategyPreview} from "@/components/HeroStrategyPreview";
import {sql} from "@/lib/db";
import {safeJsonLd,siteOrigin} from "@/lib/public-seo";
import {exactPriceString} from "@/domain/currency-money";
import {canAdvertisePaidOffer} from "@/domain/public-offer-readiness";
import {ensureSettings} from "@/lib/settings";
import {STRATEGY_PLUGINS,curatedRelease} from "@/domain/strategy/catalog";
import {assertCuratedRules} from "@/domain/strategy/curated-release";
import {VERIFIED_MARKET_MAPPINGS_SQL,verifiedCandidates} from "@/lib/verified-market-mappings";
import {cardDescription,isOfferableForUser,summariseRules} from "@/domain/explore-catalogue";
import {LandingCurrencyProvider,PublicStrategyRail,PublicPricingCards,type PublicPlanCard,type PublicStrategyCard} from "@/components/PublicLandingInteractivity";
import "./marketing-home.css";

export const dynamic="force-dynamic";
export const metadata:Metadata={alternates:{canonical:"/"}};
type PlanRow={slug:string;display_name:string;description:string|null;billing_currency:string;max_active_strategies:number|null;entitlements:unknown;homepage_highlights:unknown;monthly_price_minor:number|null;annual_price_minor:number|null;prices:unknown};
type ReleaseRow={key:string;engine_key:string;config:Record<string,unknown>;input_schema:unknown;supported_regions:unknown;supported_wrappers:unknown};
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
async function loadPublicStrategies():Promise<PublicStrategyCard[]>{
  // Public discovery is deliberately GB/ISA-specific until a visitor selects their jurisdiction.
  // Do not advertise partially implemented strategies, research records or unverified mappings.
  try{
    const [versions,marketRows]=await Promise.all([
      sql.unsafe("SELECT DISTINCT ON (d.key) d.key,d.supported_regions,d.supported_wrappers,v.engine_key,v.config,v.input_schema FROM strategy_definitions d "+
        "JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
        "WHERE d.enabled=true AND v.lifecycle_status='PUBLISHED' AND v.effective_from<=current_date "+
        "AND (v.effective_to IS NULL OR v.effective_to>=current_date) "+
        "ORDER BY d.key,v.effective_from DESC,v.published_at DESC NULLS LAST") as Promise<ReleaseRow[]>,
      sql.unsafe(VERIFIED_MARKET_MAPPINGS_SQL)
    ]);
    const releaseByKey=new Map(versions.map(row=>[row.key,row]));
    const candidates=verifiedCandidates(marketRows);
    const asOf=new Date().toISOString().slice(0,10);
    return STRATEGY_PLUGINS.flatMap((plugin):PublicStrategyCard[]=>{
      // The product owner explicitly excludes 9Sig from public homepage marketing.
      if(plugin.key.toLowerCase()==="9sig")return [];
      const release=releaseByKey.get(plugin.key);
      const canonical=curatedRelease(plugin);
      if(!release||!canonical?.config||!["FIXED_ALLOCATION","QUARTERLY_SIGNAL_TARGET"].includes(release.engine_key))return [];
      try{
        assertCuratedRules(plugin.key,String(release.engine_key),release.config,release.input_schema);
        // Public discovery targets a GB ISA account in GBP only (stated in the card category); no
        // viewer market exists here. Same predicate as createStrategy, so the rail never advertises a
        // strategy a GB/ISA/GBP user could not start.
        const market=isOfferableForUser({
          strategy:{engine:release.engine_key,config:release.config,
            supportedRegions:Array.isArray(release.supported_regions)?release.supported_regions.map(String):[],
            supportedWrappers:Array.isArray(release.supported_wrappers)?release.supported_wrappers.map(String):[]},
          userMarket:{country:"GB",wrapper:"ISA",currency:"GBP"},mappings:candidates,asOf});
        if(!market.offerable)return [];
        const summary=summariseRules(plugin);
        return [{key:plugin.key,name:String(plugin.seedDefinition?.name??plugin.profile?.name??plugin.key),
          description:cardDescription(plugin),category:"Released UK ISA method",
          allocations:summary.allocations.map(row=>({label:row.label,percent:row.percent}))}];
      }catch{return [];}
    }).slice(0,12);
  }catch{return [];}
}
// These are explicitly educational cards, not executable strategy releases.
// They never bypass the separately enforced registration/market eligibility gates.
const EDUCATIONAL_EXAMPLES:PublicStrategyCard[]=[
 {key:"example-60-40",name:"Global 60/40",category:"Educational strategy example",description:"A familiar stock-and-bond mix, reviewed periodically to restore target weights.",allocations:[{label:"Equities",percent:"60"},{label:"Bonds",percent:"40"}]},
 {key:"example-all-weather",name:"All Weather",category:"Educational strategy example",description:"Diversification across assets intended to behave differently through economic cycles.",allocations:[]},
 {key:"example-golden-butterfly",name:"Golden Butterfly",category:"Educational strategy example",description:"A five-part reference mix spanning stocks, government bonds and gold.",allocations:[{label:"Large equities",percent:"20"},{label:"Small-cap value",percent:"20"},{label:"Long bonds",percent:"20"},{label:"Short bonds",percent:"20"},{label:"Gold",percent:"20"}]},
 {key:"example-permanent-portfolio",name:"Permanent Portfolio",category:"Educational strategy example",description:"Four equal allocations to stocks, long bonds, cash and gold.",allocations:[{label:"Stocks",percent:"25"},{label:"Long bonds",percent:"25"},{label:"Cash",percent:"25"},{label:"Gold",percent:"25"}]},
 {key:"example-three-fund",name:"Three-Fund Portfolio",category:"Educational strategy example",description:"A straightforward three-sleeve structure across domestic equity, international equity and bonds.",allocations:[]}
];
export default async function HomePage(){
  await ensureSettings(); // Public schema launch state follows encrypted Admin Settings.
  const [plans,strategies]=await Promise.all([loadPublicPlans(),loadPublicStrategies()]);
  // Cloudflare injects the origin visitor country behind the existing public proxy.
  // The country controls only the preferred display unit, never an FX conversion.
  const geoHeaders=await headers();
  const visitorCurrency=currencyForVisitorCountry(geoHeaders.get("cf-ipcountry")??geoHeaders.get("x-vercel-ip-country"));
  const carouselCards=[...strategies,...EDUCATIONAL_EXAMPLES.filter(example=>!strategies.some(released=>"example-"+released.key===example.key))];
  const brand=process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr";
  const origin=siteOrigin(process.env.NEXT_PUBLIC_APP_URL).toString();
  const offered=canAdvertisePaidOffer(process.env)?plans.find(plan=>plan.monthlyMinor!==null&&plan.monthlyMinor>0):undefined;
  const offer=offered?{offers:{"@type":"Offer",price:exactPriceString(offered.monthlyMinor!,offered.currency),priceCurrency:offered.currency}}:{};
  const schema={"@context":"https://schema.org","@graph":[
    {"@type":"WebSite",name:brand,url:origin},
    {"@type":"SoftwareApplication",name:brand,applicationCategory:"FinanceApplication",
      operatingSystem:"Web",url:origin,
      description:"Track the allocations and review rules of published investment strategies. Wealtharr does not execute trades.",...offer}
  ]};
  return <LandingCurrencyProvider initialCurrency={visitorCurrency}><main className="wealtharr-marketing" id="top">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(schema)}}/>
    <header className="wm-header"><nav className="wm-shell wm-nav" aria-label="Primary navigation">
      <Link href="/" className="wm-brand"><span className="wm-mark" aria-hidden="true">⌁</span>{brand.toLowerCase()}<span className="wm-brand-dot">.</span></Link>
      <div className="wm-nav-links"><a href="#how">How it works</a><a href="#strategies">Strategies</a><a href="#preview">Live preview</a><a href="#pricing">Pricing</a></div>
      <div className="wm-nav-actions"><Link href="/login" className="wm-signin">Sign in</Link><Link href="/register" className="wm-button main">Get started ↗</Link></div>
      <details className="wm-mobile-menu"><summary aria-label="Open menu">☰</summary>
        <div><a href="#how">How it works</a><a href="#strategies">Strategies</a><a href="#preview">Live preview</a><a href="#pricing">Pricing</a><Link href="/login">Sign in</Link><Link href="/register">Get started</Link></div>
      </details>
    </nav></header>
    <div className="wm-hero-glow">
      <section className="wm-shell wm-hero">
        <div className="wm-hero-copy"><span className="wm-kicker wm-kicker-dot">A smarter way to stay on strategy</span>
          <h1>Follow the strategy.<em>Lose the spreadsheet.</em></h1>
          <p>Explore established investment approaches, track your allocations, and understand exactly when — and how — to rebalance. One beautifully simple workspace.</p>
          <div className="wm-actions"><Link href="/register" className="wm-button main">Explore your options ↗</Link><a href="#preview" className="wm-button outline">See how it works ↗</a></div>
          <div className="wm-benefits"><span>No brokerage link required</span><span>No trades placed</span><span>Every rule explained</span></div>
        </div>
        <HeroStrategyPreview/>
      </section>
    </div>
    <div className="wm-strip"><div className="wm-shell"><span><b>Established methods.</b> Your choice.</span><span><b>Clear review calculations.</b> Not just charts.</span><span><b>Your broker stays yours.</b> No trading access.</span></div></div>
    <section className="wm-section wm-strategy-section" id="strategies">
      <div className="wm-shell"><span className="wm-kicker">EXPLORE THE METHODS</span>
        <h2>Established approaches. <em>One place to follow them.</em></h2>
        <p className="wm-section-intro">Explore recognised investment frameworks. Examples do not imply availability; only released methods with eligible instruments can be started after sign-in.</p>
      </div>
      <PublicStrategyRail cards={carouselCards}/>
      <div className="wm-shell wm-note"><Link href="/strategies">How strategy availability works ↗</Link></div>
    </section>
    <section className="wm-section wm-shell" id="how">
      <span className="wm-kicker">HOW IT WORKS</span><h2>From finding an approach to <em>staying on course.</em></h2>
      <p className="wm-section-intro">No maze of spreadsheets. No disconnected reminders. Just a clear system for following a published investment method of your choice.</p>
      <div className="wm-step-grid">{[
        ["01 / DISCOVER","Choose your approach","Study a complete released methodology and understand its allocations, risks and schedule.","◇"],
        ["02 / TRACK","Make it yours","Record holdings, cash and contributions against that framework's published rules.","◎"],
        ["03 / ACT","Know your next step","Review drift and transparent calculations when an action is genuinely due.","↗"]
      ].map(([n,title,desc,glyph])=><article className="wm-step" key={n}><span>{n}</span><i aria-hidden="true">{glyph}</i><h3>{title}</h3><p>{desc}</p></article>)}</div>
    </section>
    <section className="wm-section wm-shell wm-two-col" id="preview">
      <div><span className="wm-kicker">THE MOMENT IT CLICKS</span><h2>Don&apos;t just see the drift. <em>Understand the fix.</em></h2>
        <p className="wm-section-intro">Your dashboard is meant to tell you what matters next, not persuade you to stare at markets all day.</p>
        <div className="wm-feature-list"><div><strong>Know your allocation</strong><span>Recorded versus target positions, clearly explained.</span></div>
          <div><strong>Know when to act</strong><span>Scheduled reviews and plan-aware alerts, not noisy price notifications.</span></div>
          <div><strong>Retain full control</strong><span>Wealtharr calculates; you confirm activity with your own broker.</span></div></div>
      </div>
      <div className="wm-review"><div className="wm-review-heading">◈ &nbsp; Strategy review <span>ILLUSTRATIVE</span></div>
        <h3>One clear action</h3><p>When a review is due, Wealtharr compares real recorded holdings with your published target and explains the calculation.</p>
        <div className="wm-review-event"><span>✓</span><div><strong>Next review, simplified</strong><p>See the cash needed, the changes suggested and the exact calculation inputs. No order is placed for you.</p></div></div>
        <Link href="/demo" className="wm-button outline">Explore the interactive demo ↗</Link>
      </div>
    </section>
    <section className="wm-section wm-pricing-section" id="pricing"><div className="wm-shell"><div className="wm-centered">
      <span className="wm-kicker">PRICING THAT MAKES SENSE</span><h2>Start simple. <em>Go deeper when you need to.</em></h2>
      <p className="wm-section-intro">Every plan, price and included notification channel below comes from live administrator settings—not an invented subscription offer.</p>
    </div><PublicPricingCards plans={plans}/>
      <p className="wm-note wm-centered">Availability, eligibility and payment are verified at sign-up and checkout. External brokerage costs are separate.</p>
    </div></section>
    <section className="wm-section wm-end-cta"><div className="wm-shell wm-centered">
      <span className="wm-kicker">YOUR STRATEGY. ONE CLEAR PLACE.</span><h2>Make the plan.<em>Then stay with it.</em></h2>
      <p className="wm-section-intro">Focus on following the framework rather than maintaining a spreadsheet.</p>
      <Link href="/register" className="wm-button main">Get started ↗</Link>
    </div></section>
    <footer className="wm-footer"><div className="wm-shell">
      <strong>{brand.toLowerCase()}.</strong><div><Link href="/features">Features</Link><Link href="/strategies">Strategies</Link><Link href="/pricing">Pricing</Link><Link href="/faq">FAQ</Link><Link href="/learn">Learning guides</Link><Link href="/research-disclaimer">Research disclaimer</Link></div>
      <p>Research and portfolio tracking, not a brokerage or investment adviser. Capital is at risk; past performance is not a guide to future results. Illustrative charts do not represent actual performance.</p>
    </div></footer>
  </main></LandingCurrencyProvider>;
}
