"use client";

import { useState } from "react";
import Link from "next/link";
import type { PublicPlan } from "@/lib/public-plans";

function money(minor: number, currency: string): string {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: minor === 0 ? 0 : 2 }).format(minor / 100); }
  catch { return currency + " " + (minor / 100).toFixed(2); }
}
export function PublicPlanCards({ plans }: { plans: PublicPlan[] }) {
  const [cadence, setCadence] = useState<"monthly" | "annual">("monthly");
  if (!plans.length) return null;
  const hasAnnual = plans.some(p => p.annualMinor !== null && p.annualMinor > 0);
  return <div className="landing-plans">
    {hasAnnual && <div className="landing-cycle" role="group" aria-label="Choose a billing period">
      <button type="button" aria-pressed={cadence === "monthly"} onClick={() => setCadence("monthly")}>Monthly</button>
      <button type="button" aria-pressed={cadence === "annual"} onClick={() => setCadence("annual")}>Annually</button>
    </div>}
    <div className="landing-pricing-grid">
      {plans.map(plan => {
        const free = plan.slug === "free";
        const value = cadence === "annual" ? plan.annualMinor : plan.monthlyMinor;
        const priceAvailable = value !== null && (free || value > 0);
        const activeStripe = plan.paymentMethods.includes("STRIPE") && plan.stripeReady;
        const canStart = free || (priceAvailable && activeStripe);
        return <article key={plan.slug} className={"landing-price-card" + (plan.marketing.featured ? " is-featured" : "")}>
          {plan.marketing.badge && <span className="landing-price-badge">{plan.marketing.badge}</span>}
          <h3>{plan.marketing.title}</h3>
          <p className="landing-price-description">{plan.marketing.subtitle}</p>
          <div className="landing-price-value">
            {priceAvailable ? money(value, plan.currency) : "Unavailable"}
            {priceAvailable && <small>/{cadence === "monthly" ? "mo" : "yr"}</small>}
          </div>
          <p className="landing-price-footnote">{free ? "No payment required" : priceAvailable && cadence === "monthly" && plan.annualMinor !== null ? "Annual billing also available" : priceAvailable ? "Billed " + (cadence === "annual" ? "annually" : "monthly") : "This billing period is not configured"}</p>
          <div className="landing-price-rule"/>
          <div className="landing-benefits">
            {plan.marketing.benefits.map((benefit, i) => <div key={i}><span aria-hidden="true">✓</span>{benefit}</div>)}
          </div>
          {canStart ? <Link href={"/register?plan=" + encodeURIComponent(plan.slug)} className="landing-price-cta">{plan.marketing.cta} <span aria-hidden="true">→</span></Link> :
            <span className="landing-price-cta is-disabled" aria-label="Not available for checkout">Checkout not available</span>}
        </article>;
      })}
    </div>
    <p className="landing-fineprint">Plan features and payment options depend on published administrator settings. Paid checkout requires an active verified billing connection.</p>
  </div>;
}