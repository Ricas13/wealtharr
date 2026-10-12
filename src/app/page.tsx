import Link from "next/link";
import { sql } from "@/lib/db";
import { VERIFIED_MARKET_MAPPINGS_SQL, verifiedCandidates } from "@/lib/verified-market-mappings";
import { assertCuratedRules } from "@/domain/strategy/curated-release";
import { assessStrategyMarket } from "@/domain/strategy/market-eligibility";
import { safeJsonLd, siteOrigin } from "@/lib/public-seo";
import { loadPublicPlans } from "@/lib/public-plans";
import type { PublicStrategy } from "@/components/StrategyMarquee";
import { StrategyMarquee } from "@/components/StrategyMarquee";
import { LandingInteractiveDemo } from "@/components/LandingInteractiveDemo";
import { PublicPlanCards } from "@/components/PublicPlanCards";
import "./landing.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const brand = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Wealtharr";
  const origin = siteOrigin(process.env.NEXT_PUBLIC_APP_URL).toString();
  const plans = await loadPublicPlans().catch(() => []);
  let strategies: PublicStrategy[] = [];
  try {
    const [rows, mappingRows] = await Promise.all([
      sql.unsafe(
        "SELECT d.key,d.name,d.description,d.family,v.engine_key,v.config,v.input_schema " +
        "FROM strategy_definitions d JOIN LATERAL (" +
        " SELECT * FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED' " +
        " AND v.effective_from<=current_date AND (v.effective_to IS NULL OR v.effective_to>=current_date) " +
        " ORDER BY v.effective_from DESC,v.published_at DESC NULLS LAST LIMIT 1) v ON true " +
        "WHERE d.enabled=true AND d.proprietary=false " +
        "ORDER BY CASE WHEN d.key='all-weather' THEN 0 WHEN d.key='60-40' THEN 1 " +
        "WHEN d.key='golden-butterfly' THEN 2 WHEN d.key='permanent-portfolio' THEN 3 ELSE 4 END,d.name LIMIT 40"
      ),
      sql.unsafe(VERIFIED_MARKET_MAPPINGS_SQL)
    ]);
    const candidates = verifiedCandidates(mappingRows);
    const today = new Date().toISOString().slice(0,10);
    // Marketable strategies must be fully published AND genuinely usable in a UK ISA.
    // No draft, disabled, unverified or proprietary strategy may enter this carousel.
    strategies = rows.filter(row => {
      try {
        assertCuratedRules(String(row.key), String(row.engine_key), row.config, row.input_schema);
        return assessStrategyMarket(String(row.engine_key), (row.config ?? {}) as Record<string,unknown>,
          candidates,{country:"GB",wrapper:"ISA",currency:"GBP"},today).available;
      } catch { return false; }
    }).map(row => ({
      key: String(row.key),
      name: String(row.name).split("—")[0].trim().replace(" (reference)", ""),
      description: String(row.description || ""),
      family: String(row.family),
      available: true
    }));
  } catch {
    // Never replace unavailable catalogue or published plan data with invented offers.
  }

  const website = {"@context":"https://schema.org","@graph":[
    {"@type":"WebSite","name":brand,"url":origin},
    {"@type":"SoftwareApplication","name":brand,"applicationCategory":"FinanceApplication",
      "operatingSystem":"Web","url":origin,
      "description":"Follows published investment strategy calculations, portfolio allocations and scheduled reviews; does not custody assets or place trades."}
  ]};
  return <main className="landing" id="main">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(website)}}/>
    <a className="landing-skip" href="#how-it-works">Skip to main content</a>
    <header className="landing-header"><nav className="landing-wrap landing-header-inner" aria-label="Main navigation">
      <Link className="landing-logo" href="/" aria-label={brand + " homepage"}><i aria-hidden="true">◈</i><span>{brand.toLowerCase()}<b>.</b></span></Link>
      <div className="landing-links">
        <a href="#how-it-works">How it works</a>
        {strategies.length>0&&<a href="#strategies">Explore strategies</a>}
        <a href="#demo">Interactive demo</a>
        {plans.length>0&&<a href="#plans">Pricing</a>}
      </div>
      <div className="landing-header-actions">
        <Link href="/login" className="landing-login">Log in</Link>
        <Link href="/register" className="landing-btn primary">Get started <span aria-hidden="true">↗</span></Link>
      </div>
      <details className="landing-mobile-nav"><summary>Menu</summary><div>
        <a href="#how-it-works">How it works</a>
        {strategies.length>0&&<a href="#strategies">Explore strategies</a>}
        <a href="#demo">Interactive demo</a>
        {plans.length>0&&<a href="#plans">Pricing</a>}
        <Link href="/login">Log in</Link>
        <Link href="/register">Get started</Link>
      </div></details>
    </nav></header>

    <section className="landing-hero-bg" aria-labelledby="landing-heading"><div className="landing-wrap landing-hero">
      <div className="landing-hero-copy">
        <div className="landing-kicker landing-kicker-dot">A calmer way to follow investment strategies</div>
        <h1 id="landing-heading">Follow the strategy.<em>Lose the spreadsheet.</em></h1>
        <p>Follow established investment methodologies without endless formulas and tabs. Wealtharr tracks your allocations, applies the defined rules and helps you understand when it&apos;s time to review.</p>
        <div className="landing-hero-buttons">
          <Link href="/register" className="landing-btn primary">Start tracking <span aria-hidden="true">↗</span></Link>
          <a href="#demo" className="landing-btn secondary">Try the interactive demo <span aria-hidden="true">↗</span></a>
        </div>
        <div className="landing-points"><span>Established methodologies</span><span>Clear calculations</span><span>You control every trade</span></div>
        <a href="#how-it-works" className="landing-scroll-hint">Discover what&apos;s possible <span aria-hidden="true">↓</span></a>
      </div>
      <div className="landing-hero-visual">
        <div className="landing-preview" aria-label="Fictional example Wealtharr portfolio overview">
          <div className="landing-preview-bar"><span className="landing-preview-lights" aria-hidden="true">● ● ●</span><strong>{brand}</strong><span>STRATEGY OVERVIEW</span><span className="landing-example-pill">DEMO DATA</span></div>
          <div className="landing-preview-content">
            <div className="landing-preview-top"><div><small>GOOD EVENING</small><h2>Your strategy, in focus.</h2></div><span className="landing-preview-badge">● Tracking</span></div>
            <div className="landing-preview-stats">
              <div><small>Example portfolio</small><strong>£24,680</strong><em>Hypothetical</em></div>
              <div><small>Tracked examples</small><strong>2</strong><em>Sample records</em></div>
              <div><small>Reviews due</small><strong>1</strong><em>Illustration</em></div>
            </div>
            <div className="landing-preview-visuals">
              <div className="landing-preview-mini">
                <div className="landing-preview-mini-heading"><strong>Allocation drift</strong><small>Current vs target</small></div>
                <div className="landing-preview-bars">
                  {[
                    { name:"Equities", current:29, target:30 },
                    { name:"Bonds", current:52, target:55 },
                    { name:"Gold", current:9, target:8 },
                    { name:"Commodities", current:10, target:7 }
                  ].map(row=><div className="landing-preview-asset" key={row.name}>
                    <span>{row.name}</span><div className="landing-preview-track"><i style={{width:row.current+"%"}}/><b style={{left:row.target+"%"}}/></div>
                    <span>{row.current}%</span>
                  </div>)}
                </div>
                <div className="landing-preview-legend">Mint = example allocation · Marker = example target</div>
              </div>
              <div className="landing-preview-mini landing-preview-list">
                <div className="landing-preview-mini-heading"><strong>Your strategies</strong><small>Example</small></div>
                <div className="landing-preview-row"><span className="landing-preview-icon">01</span><div><h3>Illustrative portfolio A</h3><p>Fictional allocation</p></div><span className="landing-preview-state">Review due</span></div>
                <div className="landing-preview-row"><span className="landing-preview-icon">02</span><div><h3>Illustrative portfolio B</h3><p>Fictional allocation</p></div><span className="landing-preview-state good">On track</span></div>
              </div>
            </div>
            <div className="landing-preview-alert"><span aria-hidden="true">↗</span><div><strong>A clearer review is ready.</strong><p>Example: see what changed and understand the next calculation.</p></div></div>
          </div>
        </div>
        <p className="landing-caption">Illustrative interface · Fictional balances and allocations, not investment performance</p>
      </div>
    </div></section>

    <div className="landing-context-strip"><div className="landing-wrap landing-strip-grid">
      <div>01 <strong>Choose a methodology</strong></div>
      <div>02 <strong>Understand your allocation</strong></div>
      <div>03 <strong>Review on your terms</strong></div>
    </div></div>

    <section className="landing-wrap landing-section" id="how-it-works">
      <div className="landing-section-head"><span className="landing-kicker">Simplicity, by design</span>
        <h2 className="landing-title">The strategy is defined.<em>We make it easier to follow.</em></h2>
        <p>Spend less time maintaining a spreadsheet. Put your attention on the rules, the portfolio and the next review.</p>
      </div>
      <div className="landing-how-grid">
        <article className="landing-how-card"><span className="landing-how-number">01 / DISCOVER</span><span className="landing-how-glyph" aria-hidden="true">◎</span><h3>Explore established methods</h3><p>Read the rules and choose an approach you understand. Available methods depend on your account and plan.</p></article>
        <article className="landing-how-card"><span className="landing-how-number">02 / TRACK</span><span className="landing-how-glyph" aria-hidden="true">◫</span><h3>See the full picture</h3><p>Record holdings, review target weights and follow a clear view of your strategy&apos;s calculations.</p></article>
        <article className="landing-how-card"><span className="landing-how-number">03 / REVIEW</span><span className="landing-how-glyph" aria-hidden="true">↗</span><h3>Know what comes next</h3><p>See when it&apos;s time to review. Examine the calculations and make any trades yourself.</p></article>
      </div>
    </section>

    <StrategyMarquee strategies={strategies}/>
    <LandingInteractiveDemo/>

    <section className="landing-difference" aria-labelledby="landing-difference-title"><div className="landing-wrap landing-section">
      <div className="landing-section-head is-centred"><span className="landing-kicker">Less admin. More direction.</span>
        <h2 className="landing-title" id="landing-difference-title">Less time updating.<em>More time understanding.</em></h2>
        <p>The most useful screen isn&apos;t the one with the most numbers. It&apos;s the one that makes your next review easier.</p>
      </div>
      <div className="landing-difference-grid">
        <article className="landing-comparison"><div className="landing-comparison-heading">A complicated process <span>BEFORE</span></div>
          <div className="landing-sheet">
            {["Asset | Current | Target","Equities | 29% | 30%","Bonds | 52% | 55%","Gold | 9% | 8%","New cash | £500 | ?","Review | =IF(...) | #REF!"].map((line,i)=>
              <div className="landing-sheet-row" key={line}>{line.split(" | ").map((value,j)=><span key={j}>{value}</span>)}</div>)}
          </div><p>Manual formulas, separate tabs and calendar reminders.</p>
        </article>
        <article className="landing-comparison after"><div className="landing-comparison-heading">One clear review <span>WITH WEALTHARR</span></div>
          <div className="landing-example-notice"><small>● &nbsp; EXAMPLE STRATEGY CHECK-IN</small><h3>Time to review your portfolio.</h3>
            <p>Your hypothetical asset weights have moved. Understand the differences and see a cash-allocation example before taking action.</p>
            <Link href="/demo">See the full product demo <span aria-hidden="true">↗</span></Link>
          </div><p>A practical explanation instead of a spreadsheet chore.</p>
        </article>
      </div>
    </div></section>

    <section className="landing-wrap landing-section" id="trust">
      <div className="landing-section-head"><span className="landing-kicker">Built for thoughtful investors</span>
        <h2 className="landing-title">Elegant where it matters.<em>Transparent everywhere.</em></h2>
        <p>Financial software should help you understand what&apos;s happening, without asking you to trust a black box.</p>
      </div>
      <div className="landing-trust-grid">
        <article><span aria-hidden="true">⌑</span><h3>You keep control</h3><p>Wealtharr doesn&apos;t hold your assets or execute trades. You choose what to do.</p></article>
        <article><span aria-hidden="true">◎</span><h3>Rules you can inspect</h3><p>See the method, inputs and calculations behind each strategy review.</p></article>
        <article><span aria-hidden="true">↗</span><h3>Account-aware access</h3><p>Strategy availability depends on published rules, supported instruments and your plan or investment account.</p></article>
      </div>
    </section>

    {plans.length>0&&<section className="landing-pricing-section" id="plans"><div className="landing-wrap landing-section">
      <div className="landing-section-head is-centred"><span className="landing-kicker">Plans &amp; pricing</span>
        <h2 className="landing-title">Start simple.<em>Go deeper when you need to.</em></h2>
        <p>Choose the tracking features that suit you. Every published price, inclusion, payment option and card description comes from the admin dashboard.</p>
      </div>
      <PublicPlanCards plans={plans}/>
    </div></section>}

    <section className="landing-wrap landing-last-cta"><span className="landing-kicker">Your method. One clear place.</span>
      <h2>Make the plan.<em>Then stay with it.</em></h2>
      <p>Discover established methodologies, understand the rules and manage your investment routine without living in spreadsheets.</p>
      <div className="landing-hero-buttons"><Link href="/register" className="landing-btn primary">Get started <span aria-hidden="true">↗</span></Link><a href="#demo" className="landing-btn secondary">Try the demo <span aria-hidden="true">↗</span></a></div>
    </section>
    <footer className="landing-wrap landing-footer">
      <div><strong>{brand.toLowerCase()}.</strong><p>Established investment strategies, simplified.</p></div>
      <div><Link href="/strategies">Strategies</Link> · <Link href="/features">Features</Link> · <Link href="/faq">FAQ</Link> {plans.length>0&&<>· <Link href="/pricing">Pricing</Link></>}</div>
      <p className="landing-footer-legal">Rules-based portfolio calculation and tracking software, not personalised investment advice. Wealtharr does not place trades or hold your assets. Capital is at risk, and past performance does not guarantee future returns.</p>
    </footer>
  </main>;
}
