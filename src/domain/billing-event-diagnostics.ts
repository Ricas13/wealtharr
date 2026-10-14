// Provider exceptions may contain URLs, Stripe identifiers or credentials. Only
// these application-owned fixed codes are safe to show to Admin; everything else
// stays in protected logs. Never show arbitrary error.message in a dashboard.
const SAFE_BILLING_CODES=new Set([
  "AMBIGUOUS_STRIPE_PRICE",
  "STRIPE_CUSTOMER_MISSING",
  "AMBIGUOUS_SUBSCRIPTION_OWNER",
  "SUBSCRIPTION_CUSTOMER_OWNERSHIP_CONFLICT",
  "SUBSCRIPTION_OWNER_NOT_VERIFIED",
  "STRIPE_METADATA_OWNER_MISMATCH",
  "LOCAL_BILLING_OWNER_MISSING",
  "PLAN_NOT_RESOLVED",
  "STRIPE_RECURRING_PRICE_MISSING",
  "WEBHOOK_FAILED"
]);

export function safeBillingErrorCode(raw:unknown):string {
  if(typeof raw!=="string"||!raw)return "No safe code recorded";
  return SAFE_BILLING_CODES.has(raw)?raw:"Details withheld — inspect protected server logs";
}
