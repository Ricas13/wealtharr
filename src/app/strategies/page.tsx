import Link from "next/link";
import type {Metadata} from "next";
export const metadata:Metadata={
 title:"Verified Investment Strategy Tracking",
 description:"Understand how Wealtharr tracks published investment methodologies and their account-specific rules, holdings and review dates.",
 alternates:{canonical:"/strategies"},
 openGraph:{title:"Track different investing strategies",description:"Track strategy rules, review dates and allocation changes without mixing methodologies.",url:"/strategies"}
};
const types=[
 ["Released methods only","A strategy is offered only when its complete methodology and the required account-specific instruments have passed the release checks."],
 ["Transparent review calculations","For a released strategy, see the review schedule, target exposures and why each proposed action was calculated."],
 ["Real portfolio evidence","Track recorded holdings, cash, contributions and confirmed broker fills without treating a model portfolio as an actual account."],
 ["Your decisions remain yours","Wealtharr does not recommend which strategy is suitable or place orders with your broker."]
];
export default function StrategiesPage(){return <main><div className="container"><nav className="public-nav"><Link href="/" className="brand">{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link><Link href="/demo" className="button">View example</Link></nav>
<section className="section"><div className="eyebrow">Strategy tracking</div><h1>One portfolio workspace. Different rules.</h1><p className="help">Explore only complete, approved methodologies supported for your account. If no strategy has passed its release and market checks, nothing is presented as available.</p>
<div className="cards" style={{marginTop:24}}>{types.map(([name,detail])=><article className="card" key={name}><h2 style={{fontSize:22}}>{name}</h2><p>{detail}</p></article>)}</div>
</section><section className="section"><h2>Why the calculation method matters</h2><p>Different methodologies require their own versioned rules and validated inputs. Wealtharr displays only fully available strategies; proposed trades remain calculations from the selected rules, not investment recommendations.</p><Link href="/features" className="button primary">Explore platform features</Link></section>
<footer className="footer"><Link href="/">Home</Link> · <Link href="/pricing">Pricing</Link> · <Link href="/faq">Frequently asked questions</Link></footer></div></main>}
