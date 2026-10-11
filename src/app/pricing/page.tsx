import Link from "next/link";
import type { Metadata } from "next";
import { loadPublicPlans } from "@/lib/public-plans";
import { PublicPlanCards } from "@/components/PublicPlanCards";
import "../landing.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title:"Plans and Pricing",
  description:"Explore published subscription plans for rules-based investment strategy tracking.",
  alternates:{canonical:"/pricing"}
};

export default async function PricingPage() {
  const plans=await loadPublicPlans().catch(()=>[]);
  return <main className="landing">
    <nav className="landing-header"><div className="landing-wrap" style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <Link className="landing-logo" href="/"><i aria-hidden="true">w</i>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link>
      <Link className="landing-btn" href="/login">Log in</Link>
    </div></nav>
    <section className="landing-pricing-section"><div className="landing-wrap landing-section">
      <div className="landing-kicker">Plans &amp; pricing</div>
      <h1 className="section-title" style={{textAlign:"center",fontSize:"clamp(35px,4vw,52px)",letterSpacing:"-.055em"}}>Simple plans. Powerful tracking.</h1>
      <p className="landing-section-desc">Plan prices and feature descriptions are configured and published by the platform administrator.</p>
      {plans.length ? <PublicPlanCards plans={plans}/> :
        <p className="landing-section-desc" style={{padding:"30px 0"}}>No subscription plans are currently published.</p>}
    </div></section>
    <footer className="landing-wrap landing-footer"><Link href="/">Home</Link><Link href="/features">Features</Link></footer>
  </main>;
}