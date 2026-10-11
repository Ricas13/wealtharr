/** Checkout advertises one fixed price per month/year, never usage or multi-period billing. */
export function isSinglePeriodPrice(price: {
  billing_scheme?: string | null;
  transform_quantity?: unknown;
  recurring?: { interval_count?: number; usage_type?: string } | null;
}) {
  return price.billing_scheme === "per_unit" && price.transform_quantity == null &&
    price.recurring?.interval_count === 1 && price.recurring.usage_type === "licensed";
}
