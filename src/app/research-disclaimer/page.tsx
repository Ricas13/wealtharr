import Link from "next/link";
import type {Metadata} from "next";
import {safeJsonLd,siteOrigin} from "@/lib/public-seo";

export const metadata:Metadata={
 title:"Research Disclaimer and Investment Risks",
 description:"How Wealtharr’s self-directed portfolio calculations work, what the results mean, and important risks about prices, leverage and investment decisions.",
 alternates:{canonical:"/research-disclaimer"},
 openGraph:{title:"Research Disclaimer and Investment Risks",url:"/research-disclaimer",
  description:"Understand the limits of rule-based investment calculations and your responsibility for decisions."}
};
export default function ResearchDisclaimerPage(){
 const origin=siteOrigin(process.env.NEXT_PUBLIC_APP_URL).toString();
 const structured={"@context":"https://schema.org","@type":"WebPage",name:"Research disclaimer and investment risks",
  url:new URL("/research-disclaimer",origin).toString(),description:"The purpose and limitations of Wealtharr’s self-directed research and portfolio calculation tools."};
 return <main className="container">
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:safeJsonLd(structured)}}/>
  <nav className="public-nav" aria-label="Public pages"><Link className="brand" href="/">Wealtharr</Link><Link href="/faq">Help and FAQ</Link></nav>
  <article className="section research-document">
   <div className="eyebrow">Important information</div>
   <h1>For research and educational purposes only</h1>
   <p><strong>Wealtharr is a self-directed portfolio research, tracking and calculation tool.</strong>
    It applies predefined mathematical rules to strategies and information you choose. It is not a personal financial adviser,
    does not assess your objectives, risk tolerance or suitability, and does not decide what you should buy or sell.</p>
   <h2>Calculated results are not personal recommendations</h2>
   <p>Any estimated allocation, purchase, sale, review date or reminder is the output of the selected rule set and recorded inputs.
    A calculation is not an instruction or recommendation to make an investment. You remain responsible for your decisions and
    for checking whether any investment or product is available and appropriate for your own circumstances.</p>
   <h2>You are responsible for your brokerage transactions</h2>
   <p>Wealtharr does not place, change or cancel orders with a brokerage account. Indicative prices can differ from real execution
    prices. You should confirm actual quantities, prices, fees, currencies and transaction dates using your own broker records.</p>
   <h2>Data and modelling limitations</h2>
   <p>Market information may be delayed, unavailable, unadjusted or inaccurate. Corporate actions, dividends, foreign exchange,
    taxes and brokerage costs can materially change an outcome. Historical calculations and examples do not predict future returns.
    When reliable data is unavailable, the application may be unable to produce an actionable calculation.</p>
   <h2>Investment and leverage risks</h2>
   <p>All investments can fall in value and you may receive less than you invest. Leveraged ETFs and ETPs can lose substantial value
    over short periods; daily-reset leverage, volatility, fees and financing costs can cause long-term outcomes to diverge
    markedly from a simple multiple of an underlying index. Strategies are not guaranteed to outperform or preserve capital.</p>
   <h2>Independent verification</h2>
   <p>Review the underlying methodology, issuer documentation and account eligibility yourself before acting. Consider obtaining
    appropriately qualified independent professional advice where you need a suitability assessment or assistance making a decision.</p>
   <p><strong>This disclosure does not override applicable law or regulation.</strong> It explains the tool’s intended scope
    and should not be read as a determination of regulatory status or an exclusion of rights that cannot legally be excluded.</p>
  </article>
  <footer className="footer"><Link href="/">Home</Link> · <Link href="/learn">Learning guides</Link> · <Link href="/tools/rebalance-calculator">Free calculator</Link> · <Link href="/faq">FAQ</Link></footer>
 </main>;
}
