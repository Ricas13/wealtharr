import Link from "next/link";
import { sql } from "@/lib/db";
import { safeJsonLd, siteOrigin } from "@/lib/public-seo";
import { loadPublicPlans } from "@/lib/public-plans";
import type { PublicStrategy } from "@/components/StrategyMarquee";
import { StrategyMarquee } from "@/components/StrategyMarquee";
import { PublicPlanCards } from "@/components/PublicPlanCards";
import "./landing.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const brand = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Wealtharr";
  const origin = siteOrigin(process.env.NEXT_PUBLIC_APP_URL).toString();
  const plans = await loadPublicPlans().catch(() => []);
  let strategies: PublicStrategy[] = [];
  try {
    const rows = await sql.unsafe(
      "SELECT d.key,d.name,d.description,d.family,d.enabled," +
      "EXISTS(SELECT 1 FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED') AS published " +
      "FROM strategy_definitions d WHERE d.proprietary=false AND d.key NOT IN ('3sig','6sig','9sig','income-sig') ORDER BY " +
      "CASE WHEN d.key='all-weather' THEN 0 WHEN d.key='60-40' THEN 1 WHEN d.key='golden-butterfly' THEN 2 " +
      "WHEN d.key='permanent-portfolio' THEN 3 ELSE 4 END,d.name LIMIT 40"
    );
    strategies = rows.map(row => ({
      key: String(row.key),
      name: String(row.name).replace(/\s*—.*$/, "").replace(/\s*\(reference\)$/i, ""),
      description: String(row.description || ""),
      family: String(row.family),
      available: Boolean(row.enabled && row.published)
    }));
  } catch {
    // Catalogues are not invented when the authoritative database is unavailable.
  }
  const website = {"@context":"https://schema.org","@graph":[
    {"@type":"WebSite","name":brand,"url":origin},
    {"@type":"SoftwareApplication","name":brand,"applicationCategory":"FinanceApplication",
      "operatingSystem":"Web","url":origin,
      "description":"Tracks published investment strategy calculations, allocations and review reminders; does not place trades."}
  ]};
  return <main className="landing">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(website)}}/>
    <nav className="landing-header">
      <div className="landing-wrap" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:20}}>
        <Link className="landing-logo" href="/"><i aria-hidden="true">w</i>{brand}</Link>
        <div className="landing-links">
          <a href="#strategies">Explore strategies</a>
          <a href="#how-it-works">How it works</a>
          <Link href="/features">Features</Link>
          {plans.length>0&&<a href="#plans">Pricing</a>}
        </div>
        <div className="landing-header-actions">
          <Link href="/login" className="landing-btn">Log in</Link>
          <Link href="/register" className="landing-btn primary">Get started ↗</Link>
        </div>
        <details className="landing-mobile-nav"><summary>Menu</summary><div>
          <a href="#strategies">Explore strategies</a><a href="#how-it-works">How it works</a>
          <Link href="/features">Features</Link>{plans.length>0&&<a href="#plans">Pricing</a>}
          <Link href="/login">Log in</Link><Link href="/register">Get started</Link>
        </div></details>
      </div>
    </nav>
    <div className="landing-hero-bg"><div className="landing-wrap landing-hero">
      <div>
        <div className="landing-kicker">✦ Smart strategy tracking</div>
        <h1>Follow the strategy.<br/><span className="landing-gradient-text">Not the spreadsheet.</span></h1>
        <p>Explore well-known investment strategies without the manual work. Wealtharr applies their defined rules to your portfolio, calculates allocations and rebalancing adjustments, and alerts you when it&apos;s time to act.</p>
        <div className="landing-hero-buttons">
          <a href="#strategies" className="landing-btn primary">Explore strategies →</a>
          <Link href="/demo" className="landing-btn">Explore the demo ↗</Link>
        </div>
        <div className="landing-points"><span>✓ Established strategies</span><span>✓ Automated calculations</span><span>✓ Timely notifications</span></div>
      </div>
      <div>
        <div className="landing-preview">
          <div className="landing-preview-bar">● ● ● &nbsp;&nbsp; {brand} / Strategy overview</div>
          <div className="landing-preview-content">
            <div className="landing-preview-top"><div><h2>My strategies</h2><p className="landing-preview-muted">Everything in one place</p></div><span className="landing-preview-badge">● Tracking</span></div>
            <div className="landing-preview-stats">
              <div><small>Portfolio value</small><strong>£24,680</strong><em>Fictional</em></div>
              <div><small>Strategies</small><strong>2</strong><em>Being tracked</em></div>
              <div><small>Reviews due</small><strong>1</strong><em>Action available</em></div>
            </div>
            <div className="landing-preview-row"><span className="landing-preview-icon">AW</span><div><h3>All Weather Portfolio</h3><p>Multi-asset reference model</p></div><span className="landing-preview-state">Review due</span></div>
            <div className="landing-preview-row"><span className="landing-preview-icon">60</span><div><h3>60/40 Portfolio</h3><p>Stocks and bonds</p></div><span className="landing-preview-state good">On track</span></div>
            <div className="landing-preview-alert">♧ &nbsp; All Weather review ready — Review calculated changes before trading.</div>
          </div>
        </div>
        <div className="landing-caption">Illustrative dashboard · Fictional data, not actual investment performance</div>
      </div>
    </div></div>
    <StrategyMarquee strategies={strategies}/>
    <section className="landing-wrap landing-section" id="how-it-works">
      <div className="landing-kicker">Simple by design</div>
      <h2 className="section-title">The strategy is defined.<br/>We handle the tracking.</h2>
      <p className="landing-section-desc">From selecting an established method to the next review notification, Wealtharr replaces spreadsheet work with a simpler, transparent process.</p>
      <div className="landing-how-grid">
        <article className="landing-how-card"><span>01 / CHOOSE</span><h3>Explore a strategy</h3><p>Review the published method and select the portfolio approach you want to follow.</p></article>
        <article className="landing-how-card"><span>02 / TRACK</span><h3>Enter your holdings</h3><p>Record your investments. Wealtharr calculates allocations and tracks progress against the specified rules.</p></article>
        <article className="landing-how-card"><span>03 / ACT</span><h3>Receive reminders</h3><p>Know when a review is due, examine the calculations and execute the resulting trades yourself.</p></article>
      </div>
    </section>
    {plans.length>0&&<section className="landing-pricing-section" id="plans"><div className="landing-wrap landing-section">
      <div className="landing-kicker">Plans &amp; pricing</div>
      <h2 className="section-title">Simple plans.<br/><span className="landing-gradient-text">Powerful tracking.</span></h2>
      <p className="landing-section-desc">From one strategy to many, choose the tracking tools that suit you. Plan pricing and inclusions are set by the platform administrator.</p>
      <PublicPlanCards plans={plans}/>
    </div></section>}
    <div className="landing-wrap landing-outro"><div className="landing-outro-inner">
      <div><h2>Keep the strategy.<br/>Lose the spreadsheet.</h2><p>Established methodologies. Automated tracking. One beautifully simple platform.</p></div>
      <Link href="/register" className="landing-btn primary">Get started →</Link>
    </div></div>
    <footer className="landing-wrap landing-footer">
      <span>{brand} · Investment strategies, simplified.<br/>Rule-calculation software, not investment advice. Investments involve risk; you control every trade.</span>
      <span><Link href="/strategies">Strategies</Link> · <Link href="/features">Features</Link> · <Link href="/faq">FAQ</Link>{plans.length>0&&<> · <Link href="/pricing">Pricing</Link></>}</span>
    </footer>
  </main>;
}