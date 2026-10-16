import Link from "next/link";
import type {Metadata} from "next";
import {LearningGuide} from "@/components/LearningGuide";
export const metadata:Metadata={
 title:"How portfolio rebalancing calculations work",
 description:"An example of the maths behind portfolio rebalancing: target weights, cash, trade sizing and why real executions can differ.",
 alternates:{canonical:"/learn/portfolio-rebalancing"},
 openGraph:{title:"How portfolio rebalancing calculations work",description:"An example of the maths behind portfolio rebalancing: target weights, cash, trade sizing and why real executions can differ.",url:"/learn/portfolio-rebalancing"}
};
export default function Page(){
 return <LearningGuide title="How portfolio rebalancing calculations work" description="An example of the maths behind portfolio rebalancing: target weights, cash, trade sizing and why real executions can differ." path="/learn/portfolio-rebalancing">
   <h2>What does portfolio rebalancing mean?</h2>
    <p>Rebalancing compares your current holding values with percentages you selected in advance. It identifies the difference; it does not tell you whether the chosen allocation fits your personal circumstances.</p>
    <h2>A worked 60/40 example</h2>
    <p>Imagine an illustrative £10,000 account holding £5,000 in equities and £5,000 in bonds. Your chosen target is 60% equities and 40% bonds.</p>
    <table><thead><tr><th scope="col">Asset</th><th scope="col">Current</th><th scope="col">Target</th><th scope="col">Difference</th></tr></thead>
    <tbody><tr><td>Equities</td><td>£5,000</td><td>£6,000</td><td>+£1,000</td></tr><tr><td>Bonds</td><td>£5,000</td><td>£4,000</td><td>−£1,000</td></tr></tbody></table>
    <p>The target-value formula is <strong>account value × chosen weight</strong>. The hypothetical equity shortfall is £1,000, while the bond holding exceeds its target by £1,000. That is a comparison of values, not an order recommendation.</p>
    <h2>What happens when prices and fills change?</h2>
    <p>The example assumes no trading costs or price movement. Actual holdings change between calculations and execution. A whole-share account may not be able to buy exactly £1,000 of an instrument. Once a broker confirms a fill, the calculation should use the actual quantity, price, fees and remaining cash rather than treating an estimate as execution.</p>
    <h2>Contributions and withdrawals change the arithmetic</h2>
    <p>If you add £500 cash, the portfolio becomes £10,500 before price movement or fees. An equity target of 60% then corresponds to £6,300, not £6,000. A withdrawal changes the total again; some value-target strategies also apply their own rules to the target line. Do not use a generic percentage calculator as a substitute for those rules.</p>
    <h2>When should a review happen?</h2>
    <p>Some methods review monthly, quarterly or annually; others use deviations from a chosen allocation. Wealtharr stores the version of the selected rule and calculates its review schedule. Review timing is a parameter of the method, not a universal instruction.</p>
    <p><Link href="/tools/rebalance-calculator">Check your own illustrative target-value difference in the free calculator</Link>. No quote feed or trading account is required.</p>
    <p><strong>Independent reference:</strong> <a href="https://www.investor.gov/introduction-investing/getting-started/asset-allocation" target="_blank" rel="noopener noreferrer">SEC Investor.gov — Asset Allocation and Diversification</a> explains rebalancing and why allocations drift.</p>
  </LearningGuide>;
}
