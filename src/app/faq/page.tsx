import Link from "next/link";
import type {Metadata} from "next";
export const metadata:Metadata={
 title:"FAQ | Portfolio Tracking, Notifications & Prices",
 description:"Answers about automatic market prices, rules-based portfolio calculations, trade corrections, scheduled notifications, and tracking your own investing strategy.",
 alternates:{canonical:"/faq"},
 openGraph:{title:"Portfolio tracking frequently asked questions",description:"Answers about holdings, notifications, prices and strategy reviews.",url:"/faq"}
};
const questions=[
 ["Does the app execute investments for me?","No. You retain your brokerage account and control your own orders. The product is designed to calculate what user-selected rules imply and explain the underlying inputs."],
 ["Where do market prices come from?","A configured market-data provider supplies available quote references. Research-mode installations may use unofficial Yahoo Finance data, subject to its terms and availability. You should confirm the real trade price and fees from your broker."],
 ["Is Wealtharr investment advice?","No suitability assessment is provided. You select the rules, and the platform calculates results for research and educational purposes. You remain responsible for all decisions. Read the research disclaimer for the full limitations."],
 ["Can I correct the price I actually paid?","The intended workflow supports user-confirmed broker fills and an auditable override when price, fees or cash differ from the quote reference. Calculations must be refreshed after corrections."],
 ["When will I receive a strategy reminder?","Review dates follow the specific rules and calendar for the strategy version you chose. Available notification channels depend on plan entitlements and successful delivery configuration."],
 ["Does the app choose a strategy for me?","No. Strategies are selected by the user, and no automated broker execution is offered."],
 ["Can I use a UK ISA?","Eligibility and availability depend on the actual investment instrument, broker and account wrapper. The system must not assume that a US-listed ETF is available to UK ISA investors."],
 ["Are returns guaranteed?","No. Historical performance and simulated strategy examples do not guarantee future outcomes. Leveraged exchange-traded products can lose substantial value."]
];
export default function FaqPage(){return <main><div className="container"><nav className="public-nav"><Link href="/" className="brand">{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link><Link className="button primary" href="/register">Get started</Link></nav>
 <section className="section"><div className="eyebrow">Help centre</div><h1>Frequently asked questions</h1><div style={{marginTop:24}}>{questions.map(([q,a])=><section className="card" key={q} style={{marginTop:12}}><h2 style={{fontSize:21}}>{q}</h2><p>{a}</p></section>)}</div></section>
 <section className="section"><p>These explanations describe the intended rules-based tracking product; particular functions depend on active configuration and verified strategy releases.</p><Link href="/features" className="button">Explore features</Link></section>
 <footer className="footer"><Link href="/">Home</Link> · <Link href="/pricing">Pricing</Link> · <Link href="/strategies">Strategies</Link> · <Link href="/learn">Research guides</Link> · <Link href="/research-disclaimer">Disclaimer</Link></footer></div></main>}
