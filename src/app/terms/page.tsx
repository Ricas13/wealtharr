import Link from "next/link";
import type {Metadata} from "next";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Subscription Terms",description:"Private beta subscription, renewal, cancellation and account access information for Wealtharr."};
export default function TermsPage(){
 const seller=process.env.WEALTHARR_LEGAL_TRADING_ENTITY?.trim();
 const address=process.env.WEALTHARR_LEGAL_BUSINESS_ADDRESS?.trim();
 const contact=process.env.WEALTHARR_SUPPORT_EMAIL?.trim();
 const reviewed=process.env.LEGAL_PUBLIC_PAGES_VERIFIED==="true";
 return <main className="container">
  <nav className="public-nav"><Link className="brand" href="/">Wealtharr</Link><Link href="/pricing">Pricing</Link></nav>
  <article className="section research-document">
   <div className="eyebrow">Customer information</div><h1>Subscription terms</h1>
   {!reviewed&&<p role="status"><strong>Pre-launch notice:</strong> These disclosures are awaiting operator review. Live paid subscriptions must remain disabled until the legal and commercial launch checks pass.</p>}
   <h2>Who provides the service</h2>
   <p>Contracting operator: {seller||"Not yet provided"}. Business postal address: {address||"Not yet provided"}.</p>
   <p>Support and billing contact: {contact?<a href={`mailto:${contact}`}>{contact}</a>:"Not yet provided"}.</p>
   <h2>What you purchase</h2>
   <p>Wealtharr offers account-based access to portfolio recordkeeping, rule-based calculation and notification features according to the plan you select. Feature availability, supported strategies and region-specific investments are restricted and may change during a private beta. The precise price, currency and monthly or annual billing period are shown before you confirm payment in Stripe Checkout.</p>
   <h2>Automatic renewal and cancellation</h2>
   <p>Paid subscriptions renew automatically at the displayed monthly or annual interval until you cancel. To cancel future renewal, sign in and use Settings → Plan → Manage billing. Cancelling generally stops future renewals; access may continue to the paid-through date shown on your account. Cancel before the next renewal to avoid its payment. A cancellation does not automatically refund an earlier payment.</p>
   <p>Contact the operator about a payment error, dispute or refund. Nothing on this page excludes statutory cancellation, refund or other consumer rights, and applicable mandatory laws take precedence.</p>
   <h2>Account and investment information</h2>
   <p>The service does not place brokerage trades. Data, delayed quotations, model results and research may be incomplete or inaccurate; read the <Link href="/research-disclaimer">investment risk information</Link>. The fact that a tool is labelled research does not determine its status under financial-services law.</p>
   <h2>Data and privacy</h2>
   <p>See the <Link href="/privacy">privacy notice</Link> for information about account, portfolio and billing data and how to exercise your rights. Do not supply more personal information than is needed.</p>
   <p>These customer disclosures must be checked against actual product operations, business identity and applicable UK consumer and financial-services requirements before accepting live payments.</p>
  </article><footer className="footer"><Link href="/">Home</Link> · <Link href="/pricing">Pricing</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/faq">FAQ</Link></footer>
 </main>;
}
