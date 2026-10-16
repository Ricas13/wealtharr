import Link from "next/link";
import type {Metadata} from "next";
import {LearningGuide} from "@/components/LearningGuide";
export const metadata:Metadata={
 title:"Why daily-reset leveraged ETP returns can surprise investors",
 description:"Understand volatility drag and daily-reset leveraged exchange-traded products with a two-day calculation and a note about compounded returns.",
 alternates:{canonical:"/learn/leveraged-etp-risks"},
 openGraph:{title:"Why daily-reset leveraged ETP returns can surprise investors",description:"Understand volatility drag and daily-reset leveraged exchange-traded products with a two-day calculation and a note about compounded returns.",url:"/learn/leveraged-etp-risks"}
};
export default function Page(){
 return <LearningGuide title="Why daily-reset leveraged ETP returns can surprise investors" description="Understand volatility drag and daily-reset leveraged exchange-traded products with a two-day calculation and a note about compounded returns." path="/learn/leveraged-etp-risks">
   <h2>Daily leverage is not a long-term multiple</h2>
    <p>A product targeting three times an index’s <em>daily</em> movement generally does not promise three times the index’s return over a month or year. Daily resets compound gains and losses along the path taken by the underlying market.</p>
    <h2>A two-day mathematical example</h2>
    <p>Suppose an illustrative index starts at 100, rises 10% to 110, then falls about 9.09%. It ends close to 100. In an idealised product delivering exactly 3× each day’s return before fees, 100 rises by 30% to 130 and then falls by about 27.27% to approximately 94.55.</p>
    <p>Despite the index finishing nearly unchanged, the hypothetical 3× daily-reset position loses about <strong>5.45%</strong>. This is path-dependent compounding, commonly discussed as volatility drag. It is arithmetic, not a return forecast.</p>
    <h2>Real ETP outcomes introduce more variables</h2>
    <p>Financing charges, spreads, management costs, leverage mechanics, tracking error, market closures and dealing currency affect actual outcomes. During sharp falls, leveraged exposure can lose a very large proportion of its value rapidly. Some products can behave differently from the simplified example because their prospectus terms differ.</p>
    <h2>Why the correct price history matters</h2>
    <p>A quarterly rule that uses the leveraged product’s own price series must evaluate that same product and the correct trading sessions. Replacing its series with an unleveraged index and multiplying returns is not mathematically equivalent. Dividend- and split-adjusted history must also be identified explicitly where a method requires it.</p>
    <h2>A practical research checklist</h2>
    <p>Read the issuer’s current KID or other product disclosure, confirm how leverage resets, inspect historical drawdowns, understand the dealing currency and record the exact product identifier. Review whether your data source reports completed exchange sessions rather than incomplete intraday bars.</p>
    <p>This guide explains calculation mechanics, not whether a leveraged product or strategy is suitable for any individual.</p>
    <p><strong>Independent risk reference:</strong> <a href="https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/sec" target="_blank" rel="noopener noreferrer">US SEC Investor.gov — Leveraged and Inverse ETF Investor Bulletin</a>. Individual UK ETPs may have different structures and terms.</p>
  </LearningGuide>;
}
