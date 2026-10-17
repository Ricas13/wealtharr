// Local subscription statuses that mean "no live Stripe subscription is attached".
// Shared by checkout (may a new subscription be started?) and the webhook (may a
// stored subscription be replaced?) so the two cannot drift apart.
const TERMINAL_LOCAL_STATUSES = new Set(["FREE", "CANCELED", "INCOMPLETE_EXPIRED"]);

// Stripe-side statuses that still bill, or may bill again, the customer.
// A pending or paused subscription may become billable without a new checkout.
// Conservative duplicate prevention protects the customer while Stripe resolves it.
const LIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

export function isTerminalLocalStatus(status: unknown) {
  return TERMINAL_LOCAL_STATUSES.has(String(status ?? "").toUpperCase());
}

export function isTerminalStripeStatus(status: unknown) {
  const value = String(status ?? "").toLowerCase();
  return value === "canceled" || value === "incomplete_expired";
}

export function hasLiveStripeSubscription(statuses: Iterable<unknown>) {
  for (const status of statuses) {
    if (LIVE_STRIPE_STATUSES.has(String(status ?? "").toLowerCase())) return true;
  }
  return false;
}
