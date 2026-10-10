import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";

describe("Stripe webhook financial safety",()=>{
  const source=readFileSync(new URL("../src/lib/stripe-subscription-state.ts",import.meta.url),"utf8")+
    readFileSync(new URL("../src/app/api/stripe/webhook/route.ts",import.meta.url),"utf8");

  it("does not mark a concurrently-processing webhook failed",()=>{
    const catchStart=source.lastIndexOf("}catch(error){");
    const catchBlock=source.slice(catchStart);
    const guard=catchBlock.indexOf('code==="WEBHOOK_ALREADY_PROCESSING"');
    const failed=catchBlock.indexOf('markWebhookEvent(event.id,"FAILED"');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(failed).toBeGreaterThan(guard);
  });

  it("resolves subscription ownership from canonical local records when metadata is missing",()=>{
    expect(source).toContain("resolveSubscriptionUserId");
    expect(source).toContain("stripe_subscription_id=$1 LIMIT 2");
    expect(source).toContain("stripe_customer_id=$1 LIMIT 2");
    expect(source).toContain("AMBIGUOUS_SUBSCRIPTION_OWNER");
  });

  it("can resolve an exact configured Stripe price even after that price is no longer offered for new checkout",()=>{
    const resolveStart=source.indexOf("async function resolvePlanId");
    const resolveEnd=source.indexOf("async function resolveSubscriptionUserId",resolveStart);
    const block=source.slice(resolveStart,resolveEnd);
    expect(block).toContain("pp.stripe_price_id=$1");
    expect(block).not.toContain("pp.active=true");
    expect(block).toContain("AMBIGUOUS_STRIPE_PRICE");
  });

  it("acts on Stripe's current subscription state, not the possibly stale event payload",()=>{
    expect(source).toContain("stripe.subscriptions.retrieve(subscriptionId)");
    expect(source).toContain("retrieveCurrentSubscription(stripe,incoming.id)");
    expect(source).toContain("isTerminalStripeStatus(canonical.status)");
  });

  it("lets a new subscription replace a dead stored one instead of cancelling it as a duplicate",()=>{
    expect(source).toContain("SELECT stripe_subscription_id,stripe_customer_id,status,source FROM subscriptions WHERE user_id=$1 FOR UPDATE");
    expect(source).toContain("!isTerminalLocalStatus(rows[0].status)");
    // Ended subscriptions are settled before duplicate detection so they are never cancelled twice.
    expect(source.indexOf("isTerminalStripeStatus(canonical.status)")).toBeLessThan(source.indexOf("isTerminalLocalStatus(rows[0].status)"));
  });

  it("never replaces a live App Store / Google Play subscription with a website one",()=>{
    expect(source).toContain('String(rows[0].source??"STRIPE")!=="STRIPE"&&!isTerminalLocalStatus(rows[0].status)');
  });

  it("never promotes a plan from mutable metadata",()=>{
    const resolveStart=source.indexOf("async function resolvePlanId");
    const resolveEnd=source.indexOf("async function retrieveCurrentSubscription",resolveStart);
    expect(source.slice(resolveStart,resolveEnd)).not.toContain("metadata.planId");
  });
});
