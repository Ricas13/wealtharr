import Link from "next/link";
import type {Metadata} from "next";
import {PublicRebalanceCalculator} from "@/components/PublicRebalanceCalculator";
export const metadata:Metadata={
 title:"Portfolio Rebalancing Calculator | Target Allocation",
 description:"Free two-asset portfolio rebalancing calculator. Enter your portfolio value, holding value and target weight to see the transparent buy or sell difference.",
 alternates:{canonical:"/tools/rebalance-calculator"},
 openGraph:{title:"Free Portfolio Rebalancing Calculator",description:"Understand a target-weight rebalance with transparent maths.",url:"/tools/rebalance-calculator"}
};
export default function RebalanceCalculatorPage(){return <main><div className="container">
 <nav className="public-nav"><Link href="/" className="brand">{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link><Link href="/register" className="button primary">Track your own portfolio</Link></nav>
 <section className="section"><div className="eyebrow">Free investing tool</div><h1>Portfolio rebalancing calculator</h1>
 <p>Calculate how far a holding is from a chosen target percentage. The result is an arithmetic illustration, not personal investment advice or a strategy recommendation.</p>
 <div style={{marginTop:24}}><PublicRebalanceCalculator/></div></section>
 <section className="section"><h2>How the calculation works</h2><p>First multiply the total portfolio value by the holding&apos;s target weight. Then subtract its current market value. A positive result is the amount needed to reach that target; a negative result is the excess above target.</p>
 <p><strong>Example:</strong> £10,000 × 60% = £6,000. If your holding is worth £6,500, it is £500 above the chosen target.</p>
 <h2>Is this the same as 9Sig, PAA or momentum?</h2><p>No. This basic calculator assumes a fixed target weight. Value-targeting, percentage bands and momentum signals follow different rules, which must be evaluated separately using their own validated strategy versions.</p>
 <p><Link href="/strategies" className="button">Explore strategy methodologies</Link></p>
 </section><footer className="footer"><Link href="/">Home</Link> · <Link href="/features">Features</Link> · <Link href="/faq">FAQ</Link> · <Link href="/learn/portfolio-rebalancing">How rebalancing works</Link> · <Link href="/research-disclaimer">Research disclaimer</Link></footer>
 </div></main>}
