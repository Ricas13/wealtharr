/** Pure freshness classification safe for testing without server runtime. */
export const MAX_QUOTE_AGE_MS = 36 * 3_600_000;
/** Clock skew between this server and a provider clock; a quote this far ahead is still "now". */
export const FUTURE_SKEW_MS = 5 * 60_000;
/** Manual price evidence is typed by a person, so it keeps the tighter ledger-time tolerance. */
export const MANUAL_PRICE_SKEW_MS = 60_000;

export type FreshnessOptions = { maxAgeMs: number; skewMs: number };

/**
 * The single freshness rule: an observation is CURRENT when it is a valid timestamp, no further ahead
 * of `now` than `skewMs`, and no older than `maxAgeMs`. Every caller (worker, valuation, sizing,
 * manual overrides) goes through this so the tolerances cannot drift apart.
 */
export function assessFreshness(
  observedAt: Date | string | number | null | undefined,
  now: Date,
  options: Partial<FreshnessOptions> = {}
): "CURRENT" | "STALE" {
  if (observedAt == null) return "STALE";
  const maxAgeMs = options.maxAgeMs ?? MAX_QUOTE_AGE_MS;
  const skewMs = options.skewMs ?? FUTURE_SKEW_MS;
  const at = new Date(observedAt).getTime();
  const current = now.getTime();
  if (!Number.isFinite(at) || !Number.isFinite(current)) return "STALE";
  const ageMs = current - at;
  return ageMs >= -skewMs && ageMs <= maxAgeMs ? "CURRENT" : "STALE";
}

export function classifyFreshness(observedAt: Date, now = new Date(), maxAgeHours = 36) {
  return assessFreshness(observedAt, now, { maxAgeMs: maxAgeHours * 3_600_000, skewMs: FUTURE_SKEW_MS });
}
