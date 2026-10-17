import Link from "next/link";
import type {Metadata} from "next";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Privacy Notice",description:"How Wealtharr processes account, portfolio and subscription information."};
export default function PrivacyPage(){
 const seller=process.env.WEALTHARR_LEGAL_TRADING_ENTITY?.trim();
 const address=process.env.WEALTHARR_LEGAL_BUSINESS_ADDRESS?.trim();
 const contact=process.env.WEALTHARR_SUPPORT_EMAIL?.trim();
 const reviewed=process.env.LEGAL_PUBLIC_PAGES_VERIFIED==="true";
 return <main className="container">
  <nav className="public-nav"><Link className="brand" href="/">Wealtharr</Link><Link href="/terms">Terms</Link></nav>
  <article className="section research-document">
   <div className="eyebrow">Data protection information</div><h1>Privacy notice</h1>
   {!reviewed&&<p role="status"><strong>Pre-launch notice:</strong> This privacy information is awaiting operator review. It must be completed and checked before live paid subscriptions begin.</p>}
   <h2>Controller and contact</h2>
   <p>The operator responsible for the service is {seller||"not yet identified"}. Postal address: {address||"not yet provided"}. Contact: {contact?<a href={`mailto:${contact}`}>{contact}</a>:"not yet provided"}.</p>
   <h2>Information processed</h2>
   <p>Depending on features you use, Wealtharr processes your email, account security records, selected subscription, portfolio holdings, trading and cash entries you provide, strategy selections, device access information and notification choices. Stripe processes payment-card details for checkout; Wealtharr stores related customer, subscription and billing identifiers.</p>
   <h2>Why the information is used</h2>
   <p>Account and portfolio information is used to provide the services you request, maintain subscription access and payment records, protect user accounts, troubleshoot errors and fulfil applicable legal obligations. Security monitoring is used to prevent misuse. Optional anonymous-aggregate participation is controlled from account Settings.</p>
   <h2>Recipients and storage</h2>
   <p>Information may be processed by service suppliers required for hosting, billing, transactional email and your chosen notification channels. The operator must publish the actual supplier, transfer and retention details as applicable, and confirm the relevant legal bases and safeguards before the reviewed notice is approved. We do not describe a processing arrangement as verified until it has been checked.</p>
   <h2>Your choices and rights</h2>
   <p>In account Settings you can opt out of optional aggregates, request an account-data export and request account deletion. Subject to applicable law, you may also have rights to access, correct, erase, restrict or object to processing, and complain to the Information Commissioner’s Office. Contact the operator for requests and any questions about retention or data transfers.</p>
   <p>See the <Link href="/terms">subscription terms</Link> and <Link href="/research-disclaimer">investment risk disclosure</Link>. This notice needs an operator-specific legal review; its presence alone is not GDPR certification.</p>
  </article><footer className="footer"><Link href="/">Home</Link> · <Link href="/terms">Terms</Link> · <Link href="/pricing">Pricing</Link> · <Link href="/faq">FAQ</Link></footer>
 </main>;
}
