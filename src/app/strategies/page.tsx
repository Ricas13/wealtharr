import Link from "next/link";
import type {Metadata} from "next";
export const metadata:Metadata={
 title:"9Sig, Fixed Allocation & Momentum Strategy Tracking",
 description:"Learn how value-target, fixed-allocation, and momentum portfolio tracking differ. Follow your own rules with transparent calculation and review history.",
 alternates:{canonical:"/strategies"},
 openGraph:{title:"Track different investing strategies",description:"Track strategy rules, review dates and allocation changes without mixing methodologies.",url:"/strategies"}
};
const types=[
 ["Value-targeting","Set a versioned target-growth rule, record contributions and compare portfolio value against the target at each review. 9Sig belongs to this category."],
 ["Fixed allocation","Track a defined portfolio weight for each exposure, including variations of 60/40, 80/20, Permanent Portfolio or Golden Butterfly."],
 ["Momentum and trend rules","Research approaches such as Ivy, dual momentum, PAA and VAA have distinct signals. These require complete price history and independently verified versions before they are customer-enabled."],
 ["Curated strategy library","Choose a researched, versioned strategy with fixed rules. Only the eligible regional instruments and actual customer account records vary."]
];
export default function StrategiesPage(){return <main><div className="container"><nav className="public-nav"><Link href="/" className="brand">{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link><Link href="/demo" className="button">View example</Link></nav>
<section className="section"><div className="eyebrow">Strategy tracking</div><h1>One portfolio workspace. Different rules.</h1><p className="help">Choose your own investing method and track its inputs, holdings, historical changes and scheduled reviews. Availability depends on the strategy version and supported instruments.</p>
<div className="cards" style={{marginTop:24}}>{types.map(([name,detail])=><article className="card" key={name}><h2 style={{fontSize:22}}>{name}</h2><p>{detail}</p></article>)}</div>
</section><section className="section"><h2>Why the calculation method matters</h2><p>Value targets, asset weights and momentum regimes are not interchangeable. Each requires its own review rhythm, data inputs and published version. Proposed transactions are calculations from those configured rules, not investment recommendations.</p><Link href="/features" className="button primary">Explore platform features</Link></section>
<footer className="footer"><Link href="/">Home</Link> · <Link href="/pricing">Pricing</Link> · <Link href="/faq">Frequently asked questions</Link></footer></div></main>}
