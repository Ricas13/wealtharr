import Link from "next/link";
import type {Metadata} from "next";
export const metadata:Metadata={
 title:"Portfolio Tracking, Price History & Rebalance Reminders",
 description:"Explore rules-based portfolio tracking, historical price references, user-confirmed transactions, audit trails, and scheduled rebalance reminders.",
 alternates:{canonical:"/features"},
 openGraph:{title:"Portfolio tracking and rebalance reminders",description:"A clearer way to keep track of the investment rules you choose.",url:"/features"}
};
const features=[
 ["Portfolio tracking","Keep a record of your accounts, contributions, withdrawals, positions and portfolio history. Reconciling transactions remains under your control."],
 ["Price references","A connected provider can supply current and historical market observations. Confirm broker fills separately because exchange observations may differ from actual executions."],
 ["Strategy review dates","Track the dates defined by your selected strategy and receive available reminders when a new review is due."],
 ["Explainable calculations","See the rules, inputs, assumptions and target comparisons underlying each calculated adjustment."],
 ["Corrections and audit trails","Record discrepancies, broker expenses and corrected values without silently rewriting the portfolio history."],
 ["Multi-strategy workspace","Manage different rules-based approaches from the same account, subject to plan permissions and release availability."]
];
export default function FeaturesPage(){return <main><div className="container"><nav className="public-nav"><Link href="/" className="brand">{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link><Link href="/register" className="button primary">Create account</Link></nav>
 <section className="section"><div className="eyebrow">Product features</div><h1>Track the rules. See the numbers. Know the next review.</h1><p className="help">A rules-based portfolio tracker designed for self-directed investors. Provider connectivity and individual strategies depend on verified configuration.</p>
 <div className="cards" style={{marginTop:24}}>{features.map(([title,description])=><article className="card" key={title}><h2 style={{fontSize:21}}>{title}</h2><p>{description}</p></article>)}</div></section>
 <section className="section"><h2>Stay in control of every trade</h2><p>Investment decisions and broker execution remain with you. The application is designed to calculate what the rules you selected imply, not to assess whether those rules or instruments are appropriate for you.</p><p><Link href="/strategies" className="button">Explore strategy types</Link></p></section>
 <footer className="footer"><Link href="/">Home</Link> · <Link href="/pricing">Pricing</Link> · <Link href="/faq">FAQ</Link> · <Link href="/learn">Learning guides</Link> · <Link href="/learn/portfolio-tracking-spreadsheet">Spreadsheet vs tracker</Link> · <Link href="/research-disclaimer">Research disclaimer</Link></footer></div></main>}
