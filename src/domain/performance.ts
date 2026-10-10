import Decimal from "decimal.js";

export type CashFlow = { at: Date; amount: Decimal.Value };

export function timeWeightedReturn(periods: Array<{ startValue: Decimal.Value; endValue: Decimal.Value; netFlow: Decimal.Value }>) {
  return periods.reduce((growth, p) => {
    const start = new Decimal(p.startValue);
    if (start.eq(0)) return growth;
    const periodGrowth = new Decimal(p.endValue).minus(p.netFlow).div(start);
    return growth.mul(periodGrowth);
  }, new Decimal(1)).minus(1);
}

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const LOWEST_RATE = -0.99999;
const HIGHEST_RATE = 10_000;

// Money-weighted (internal) rate of return for dated cash flows, annualised. It either returns a
// rate that really zeroes the net present value or throws; it never returns an unconverged guess.
// (Newton's method alone silently returned garbage for roughly 2% of realistic loss-making
// portfolios, which the community statistics then dropped as "implausible", biasing them upward.)
//
// A rate needs trustworthy convergence, not arbitrary precision, so the solver works in double
// precision; amounts are converted once and the result is returned as a Decimal.
export function xirr(cashFlows: CashFlow[], guess = 0.1) {
  if (cashFlows.length < 2) throw new Error("XIRR requires at least two cash flows");
  const amounts = cashFlows.map((f) => new Decimal(f.amount).toNumber());
  if (!amounts.some((a) => a > 0) || !amounts.some((a) => a < 0)) throw new Error("XIRR requires positive and negative cash flows");

  const times = cashFlows.map((f) => f.at.getTime());
  const base = Math.min(...times);
  if (Math.max(...times) === base) throw new Error("XIRR requires cash flows on at least two dates");
  const years = times.map((time) => (time - base) / YEAR_MS);
  const scale = amounts.reduce((sum, a) => sum + Math.abs(a), 0);

  const npv = (rate: number) => {
    let sum = 0;
    for (let i = 0; i < amounts.length; i += 1) sum += amounts[i] / Math.pow(1 + rate, years[i]);
    return sum;
  };
  const slope = (rate: number) => {
    let sum = 0;
    for (let i = 0; i < amounts.length; i += 1) sum -= (years[i] * amounts[i]) / Math.pow(1 + rate, years[i] + 1);
    return sum;
  };
  // A rate is only accepted if it genuinely zeroes the value, relative to the money involved.
  const solves = (rate: number) => Number.isFinite(rate) && rate > -1 && Math.abs(npv(rate)) <= scale * 1e-9;

  let rate = guess;
  for (let i = 0; i < 100; i += 1) {
    const derivative = slope(rate);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-16) break;
    const next = rate - npv(rate) / derivative;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-12) {
      if (solves(next)) return new Decimal(next);
      break;
    }
    rate = next <= LOWEST_RATE ? LOWEST_RATE : next;
  }

  // Newton did not settle on a true root: bracket it instead. Bisection cannot diverge.
  let low = LOWEST_RATE;
  let high = HIGHEST_RATE;
  let lowValue = npv(low);
  const highValue = npv(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
    throw new Error("XIRR has no solution in the supported range");
  }
  for (let i = 0; i < 300; i += 1) {
    const mid = (low + high) / 2;
    const midValue = npv(mid);
    if (midValue === 0) return new Decimal(mid);
    if (lowValue * midValue < 0) high = mid;
    else {
      low = mid;
      lowValue = midValue;
    }
    if (high - low < 1e-13 * (1 + Math.abs(mid))) break;
  }
  const result = (low + high) / 2;
  if (!solves(result)) throw new Error("XIRR did not converge");
  return new Decimal(result);
}

/** Annualising a short history turns a few percent into an enormous, meaningless yearly figure. */
export const MIN_ANNUALISED_SPAN_DAYS = 365;
export function isAnnualisableSpan(flows: CashFlow[]) {
  const times = flows.map((flow) => flow.at.getTime());
  if (times.length < 2) return false;
  return (Math.max(...times) - Math.min(...times)) / 86_400_000 >= MIN_ANNUALISED_SPAN_DAYS;
}
