import Decimal from "decimal.js";

/**
 * Research-only, source-backed arithmetic for the growth Sig family.
 * This is NOT an executable strategy engine: the current subscriber-only
 * sell-skip, leverage management and reset rules are not verified.
 * Never use this helper to issue investor orders or activate a strategy.
 *
 * Sources:
 * https://jasonkelly.com/2017/01/how-my-signal-system-works/
 * https://jasonkelly.com/3sig/
 */
export type GrowthSig = "3sig" | "6sig" | "9sig";
const RATES: Readonly<Record<GrowthSig, string>> = {
  "3sig": "0.03",
  "6sig": "0.06",
  "9sig": "0.09",
};

function nonNegative(value: Decimal.Value, label: string): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new Error("INVALID_SIG_INPUT:" + label);
  }
  return parsed;
}

export type GrowthSigProjection = {
  baseTarget: string;
  contributionIncrement: string;
  target: string;
  observedExposure: string;
  gap: string;
  indicativeDirection: "BUY" | "SELL" | "HOLD";
};

/**
 * Isolates ONLY the confirmed arithmetic: preceding target grows by the
 * variant's quarterly rate, and 50% of newly contributed cash raises the
 * signal line. Choice of target anchor after an unfilled buy remains
 * deliberately external and unresolved.
 *
 * The directional comparison is informative, NOT an executable order:
 * protective no-sell rules, reset rules, reserve availability, costs and
 * fill restrictions can override it.
 */
export function projectGrowthSig(input: {
  variant: GrowthSig;
  precedingAnchor: Decimal.Value;
  newCash: Decimal.Value;
  observedExposure: Decimal.Value;
}): GrowthSigProjection {
  const rate = RATES[input.variant];
  if (rate === undefined) throw new Error("INVALID_SIG_VARIANT");
  const anchor = nonNegative(input.precedingAnchor, "precedingAnchor");
  const contributions = nonNegative(input.newCash, "newCash");
  const observed = nonNegative(input.observedExposure, "observedExposure");
  const base = anchor.mul(new Decimal(1).plus(rate));
  const increment = contributions.div(2);
  const target = base.plus(increment);
  const gap = target.minus(observed);
  return {
    baseTarget: base.toFixed(),
    contributionIncrement: increment.toFixed(),
    target: target.toFixed(),
    observedExposure: observed.toFixed(),
    gap: gap.toFixed(),
    indicativeDirection: gap.gt(0) ? "BUY" : gap.lt(0) ? "SELL" : "HOLD",
  };
}
