import Stripe from "stripe";
import { ensureSettings } from "@/lib/settings";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security";
import { hasLiveStripeSubscription, isTerminalLocalStatus } from "@/domain/subscription-status";
import { authFailure } from "@/lib/api-auth";
import { paidCheckoutBlockers } from "@/domain/commercial-launch";
import { unattestedCustomerStrategies } from "@/lib/strategy-evidence";
import { purchasesAllowedFor } from "@/domain/native-app";
import { isSinglePeriodPrice } from "@/domain/billing-price";

const schema = z.object({
  planSlug: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/).refine(slug=>slug!=="free"),
  cadence: z.enum(["monthly", "annual"]),
  currency: z.string().length(3).optional()
});

export async function POST(request: Request) {
  await ensureSettings();
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    // App-store rules: subscriptions are not sold from inside the Android/iOS apps.
    if (!purchasesAllowedFor(request.headers.get("user-agent"))) {
      return Response.json({ error: "Manage your plan on the website." }, { status: 403 });
    }
    const input = schema.parse(await request.json());
    // Paid onboarding is off until the operator has completed external
    // commercial, infrastructure, regulatory and live-provider sign-offs.
    if(process.env.WEALTHARR_PAID_LAUNCH_ENABLED!=="true"){
      return Response.json({error:"Paid subscriptions are not yet available. Wealtharr is in staging."},{status:503});
    }

    // A live Stripe key charges real cards: refuse until every launch check passes. The failed
    // check names are logged for the operator; the customer only learns billing is unavailable.
    const blockers = paidCheckoutBlockers(process.env);
    if (blockers.length) {
      console.error("Checkout refused: launch checks failing: " + blockers.map((b) => b.key).join(", "));
      return Response.json({ error: "Billing is not available yet." }, { status: 503 });
    }

    // Live payments also need a recorded specification sign-off for every strategy customers can start.
    if (/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "")) {
      const unattested = await unattestedCustomerStrategies();
      if (unattested.length) {
        console.error("Checkout refused: strategies without a recorded sign-off: " + unattested.map((u) => u.key + "@" + u.version).join(", "));
        return Response.json({ error: "Billing is not available yet." }, { status: 503 });
      }
    }

    if (!process.env.STRIPE_SECRET_KEY || !process.env.NEXT_PUBLIC_APP_URL) {
      return Response.json({ error: "Billing is not configured." }, { status: 503 });
    }

    const currency = (input.currency ?? user.baseCurrency).toUpperCase();
    const cadence = input.cadence.toUpperCase();
    const priceRows = await sql.unsafe(
      "SELECT p.id,pp.stripe_price_id,pp.amount_minor,pp.currency FROM plans p JOIN plan_prices pp ON pp.plan_id=p.id WHERE p.slug=$1 AND p.slug<>\'free\' AND p.archived=false AND p.visible=true AND pp.currency=$2 AND pp.cadence=$3 AND pp.active=true AND pp.amount_minor>0 LIMIT 1",
      [input.planSlug, currency, cadence]
    );
    const price = priceRows[0];
    if (!price) {
      return Response.json({ error: "That plan is not configured in " + currency + " for " + input.cadence + " billing." }, { status: 404 });
    }
    if (!price.stripe_price_id) {
      return Response.json({ error: "Stripe Price ID is not configured for this plan price." }, { status: 503 });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    // Published price, currency and cadence must match the actual remote
    // charge. A mismatched admin Stripe ID must never silently bill a user.
    const stripePrice=await stripe.prices.retrieve(String(price.stripe_price_id));
    const interval=input.cadence==="annual"?"year":"month";
    if(!stripePrice.active||!isSinglePeriodPrice(stripePrice)||stripePrice.currency.toUpperCase()!==currency||
       stripePrice.unit_amount!==Number(price.amount_minor)||
       stripePrice.recurring?.interval!==interval||stripePrice.type!=="recurring"){
      return Response.json({error:"Billing configuration mismatch. Checkout is disabled until an administrator corrects this price."},{status:503});
    }
    const subRows = await sql.unsafe(
      "SELECT stripe_customer_id,stripe_subscription_id,status,source FROM subscriptions WHERE user_id=$1 LIMIT 1",
      [user.id]
    );
    const local = subRows[0];
    if (local && String(local.source ?? "STRIPE") !== "STRIPE" && !isTerminalLocalStatus(local.status)) {
      return Response.json({ error: "Your subscription is billed through the " + (local.source === "APPLE" ? "App Store" : "Google Play") + ". Manage or change it there." }, { status: 409 });
    }
    if (local?.stripe_subscription_id && !isTerminalLocalStatus(local.status)) {
      return Response.json({ error: "You already have a Stripe subscription. Use Manage billing to change the plan or billing cycle." }, { status: 409 });
    }

    let customerId = local?.stripe_customer_id ? String(local.stripe_customer_id) : null;
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: user.email, metadata: { userId: user.id } },
        { idempotencyKey: "strategyos-customer-" + user.id }
      );
      customerId = customer.id;
      await sql.unsafe(
        "UPDATE subscriptions SET stripe_customer_id=$1,updated_at=now() WHERE user_id=$2 AND stripe_customer_id IS NULL",
        [customerId, user.id]
      );
      const canonical = await sql.unsafe(
        "SELECT stripe_customer_id FROM subscriptions WHERE user_id=$1 LIMIT 1",
        [user.id]
      );
      customerId = canonical[0]?.stripe_customer_id ? String(canonical[0].stripe_customer_id) : customerId;
    }

    // Local state can lag behind Stripe if a webhook was missed, so confirm with Stripe
    // that this customer is not still billed before taking a second payment.
    if (local?.stripe_customer_id) {
      const existing = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
      if (hasLiveStripeSubscription(existing.data.map((subscription) => subscription.status))) {
        return Response.json({ error: "You already have a Stripe subscription. Use Manage billing to change the plan or billing cycle." }, { status: 409 });
      }
    }

    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.id,
        line_items: [{ price: String(price.stripe_price_id), quantity: 1 }],
        success_url: process.env.NEXT_PUBLIC_APP_URL + "/app/settings?billing=success",
        cancel_url: process.env.NEXT_PUBLIC_APP_URL + "/app/settings?billing=cancelled",
        subscription_data: { metadata: { userId: user.id, planId: String(price.id) } },
        metadata: { userId: user.id, planId: String(price.id), cadence: input.cadence, currency }
      },
      { idempotencyKey: ["strategyos-checkout", user.id, String(price.id), currency, input.cadence, String(hourBucket)].join("-") }
    );
    return Response.json({ url: session.url });
  } catch(error){const denied=authFailure(error);if(denied)return denied;
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Choose a valid plan, billing cycle and currency." }, { status: 400 });
    }
    return Response.json({ error: "Could not start checkout." }, { status: 500 });
  }
}
