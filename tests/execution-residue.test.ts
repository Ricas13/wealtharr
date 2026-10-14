import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { fixedAllocationEngine } from "../src/domain/strategy/fixed-allocation";
import {
  openOutcomeNote, outcomeReasonCode, residueHoldProposal, residueLegs, roundHalfDown, sizeNextTrade, sizedTradeRows,
  type SizingLeg, type SizingOutcome
} from "../src/domain/strategy/execution-residue";
import { normalizeExecutionConstraints, planPracticalTrade, SMALLEST_TRADE_UNIT } from "../src/domain/execution";
import { postActionReviewState } from "../src/domain/strategy/review-completion";

type Spec = { exposure: string; weight: string; value: string; price: string; held?: string };
type Constraints = { fractionalShares?: boolean; allowSelling?: boolean; minimumTradeAmount?: string; cashBufferAmount?: string; flatFee?: string };

function constraintsOf(c: Constraints) {
  return normalizeExecutionConstraints({ fractionalShares: false, allowSelling: true, ...c });
}

/** Legs from specs (targets at weight x (value + cash)); the execution account holds all units and all cash. */
function build(specs: Spec[], cash: string) {
  const { legs, total } = residueLegs({
    allocations: specs.map((s) => ({ exposure: s.exposure, weight: s.weight })),
    exposures: specs.map((s) => ({ economicExposure: s.exposure, value: new Decimal(s.value) })),
    cash: new Decimal(cash)
  });
  const sizing: SizingLeg[] = legs.map((leg, i) => ({
    ...leg,
    price: new Decimal(specs[i].price),
    buyCash: new Decimal(cash),
    heldUnits: new Decimal(specs[i].held ?? new Decimal(specs[i].value).div(specs[i].price).toString())
  }));
  return { sizing, total };
}

function size(specs: Spec[], cash: string, threshold: string, c: Constraints = {}): SizingOutcome {
  const { sizing, total } = build(specs, cash);
  return sizeNextTrade({ legs: sizing, total, threshold: new Decimal(threshold), constraints: constraintsOf(c) });
}

/** Recalculate, fill at the exact planned amount (flat fee on every trade), repeat. */
function run(specs: Spec[], cash0: string, threshold: string, c: Constraints = {}, maxSteps = 20) {
  let now = specs.map((s) => ({ ...s }));
  let cash = new Decimal(cash0);
  const fee = new Decimal(c.flatFee ?? 0);
  const trades: Array<[string, string, string]> = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const out = size(now, cash.toString(), threshold, c);
    if (out.kind !== "TRADE") return { out, trades, specs: now, cash, steps: i, exhausted: false };
    const t = out.trade;
    const signed = t.side === "BUY" ? t.amount : t.amount.neg();
    now = now.map((s) => (s.exposure === t.exposure ? { ...s, value: new Decimal(s.value).plus(signed).toString() } : s));
    cash = cash.minus(signed).minus(fee);
    trades.push([t.side, t.exposure, t.amount.toFixed(2)]);
  }
  return { out: null, trades, specs: now, cash, steps: maxSteps, exhausted: true };
}

const two = (equity: string, bonds: string, prices = { EQUITY: "87.30", BONDS: "41.70" }): Spec[] => [
  { exposure: "EQUITY", weight: "0.6", value: equity, price: prices.EQUITY },
  { exposure: "BONDS", weight: "0.4", value: bonds, price: prices.BONDS }
];

describe("nearest-unit sizing", () => {
  it("rounds to the nearest unit with ties rounded down", () => {
    expect(roundHalfDown(new Decimal("0.5")).toString()).toBe("0");
    expect(roundHalfDown(new Decimal("0.51")).toString()).toBe("1");
    expect(roundHalfDown(new Decimal("1.5")).toString()).toBe("1");
    expect(roundHalfDown(new Decimal("1.5000001")).toString()).toBe("2");
    expect(roundHalfDown(new Decimal("6.985")).toString()).toBe("7");
  });

  it("headline: floor purchases when the nearest ones starve a leg, then a HOLD within one unit", () => {
    // 60/40, cash 10000, prices 87.30 / 41.70, whole shares, threshold 0. Targets 6000 / 4000.
    // Bands: EQUITY 43.65 + 8.73 = 52.38, BONDS 20.85 + 4.17 = 25.02.
    // 1. Nearest purchases: EQUITY round(68.73) = 69 -> 6023.70, BONDS round(95.92) = 96 -> 4003.20; their sum
    //    10026.90 exceeds 10000, so FLOOR: BUY EQUITY 68 = 5936.40.
    // 2. cash 4063.60: nearest 1 x 87.30 + 96 x 41.70 = 4090.50 > 4063.60, floor: BUY BONDS 95 = 3961.50.
    // 3. cash 102.10: nearest 87.30 + 41.70 = 129 > 102.10, floor gives 0 units for both, so the nearest
    //    affordable count is used: BUY EQUITY 1 = 87.30 (EQUITY 23.70 over, inside its band).
    // 4. cash 14.80: BONDS 38.50 under (< one unit 41.70, outside band 25.02), no unit affordable, and selling one
    //    EQUITY share would leave it 63.60 under (outside its band): HOLD within one unit.
    const result = run(two("0", "0"), "10000", "0");
    expect(result.trades).toEqual([["BUY", "EQUITY", "5936.40"], ["BUY", "BONDS", "3961.50"], ["BUY", "EQUITY", "87.30"]]);
    expect(result.out?.kind).toBe("HOLD");
    if (result.out?.kind === "HOLD") {
      expect(result.out.reason).toBe("WITHIN_ONE_UNIT");
      expect(result.cash.toFixed(2)).toBe("14.80");
      const hold = residueHoldProposal({ explanation: [], dueAt: null }, result.out,
        { state: {}, now: new Date("2026-10-07T12:00:00Z"), cash: result.cash, currency: "GBP", fractionalShares: false });
      // 41.70 - 14.80 = 26.90.
      expect(hold.instruction).toContain("Every holding is within one trading unit of its target.");
      expect(hold.instruction).toContain("Your cash (14.80 GBP) is less than the cost of one more unit of BONDS (41.70 GBP); add about 26.90 GBP");
      expect(hold.explanation.find((row) => row.label === "Residual cash")?.value).toBe("14.80");
      // Largest residual leg: BONDS 38.50 / 10000 = 0.385% (half-even) -> 0.38%; 38.50 - 14.80 = 23.70 more cash.
      expect(hold.explanation.find((row) => row.label === "Residual drift of the portfolio")?.value)
        .toBe("Largest leg 0.38% of the portfolio; about 23.70 GBP more cash would bring every underweight leg to target");
    }
  });

  it("closes with a HOLD once every leg is within half a unit (non-round prices 91.70 / 44.40, 55/45)", () => {
    // 55/45, cash 10000, targets 5500 / 4500, threshold 0. Bands: EQUITY 45.85 + 9.17 = 55.02, BONDS 22.20 + 4.44 = 26.64.
    // 1. nearest EQUITY 60 = 5502.00 and BONDS 101 = 4484.40 together 9986.40 <= 10000: BUY EQUITY 60 = 5502.00.
    // 2. cash 4498: BUY BONDS 101 = 4484.40. 3. EQUITY 2.00 over, BONDS 15.60 under: at target.
    const specs: Spec[] = [
      { exposure: "EQUITY", weight: "0.55", value: "0", price: "91.70" },
      { exposure: "BONDS", weight: "0.45", value: "0", price: "44.40" }
    ];
    const result = run(specs, "10000", "0");
    expect(result.trades).toEqual([["BUY", "EQUITY", "5502.00"], ["BUY", "BONDS", "4484.40"]]);
    expect(result.out?.kind).toBe("HOLD");
    if (result.out?.kind === "HOLD") {
      expect(result.out.reason).toBe("WITHIN_HALF_UNIT");
      const hold = residueHoldProposal({ explanation: [], dueAt: null }, result.out,
        { state: { forceReview: true }, now: new Date("2026-10-07T12:00:00Z"), cash: result.cash, currency: "GBP", fractionalShares: false });
      expect(hold.actionType).toBe("HOLD");
      const byLabel = Object.fromEntries(hold.explanation.map((row) => [row.label, row.value]));
      expect(byLabel["Residual cash"]).toBe("13.60");
      expect(byLabel["Residual drift EQUITY"]).toBe("over target by 2.00 GBP");
      expect(byLabel["Residual drift BONDS"]).toBe("under target by 15.60 GBP");
      expect(byLabel["Why the review closes"]).toContain("half a trading unit");
      // 15.60 / 10000 = 0.156% -> 0.16%; the underweight BONDS needs 15.60 and 13.60 of cash exists: 2.00 more.
      expect(byLabel["Residual drift of the portfolio"]).toContain("Largest leg 0.16% of the portfolio; about 2.00 GBP more cash");
      const closed = postActionReviewState(hold, { forceReview: true }, new Date("2026-10-07T12:30:00Z"));
      expect(closed.forceReview).toBe(false);
      expect(closed.lastReviewAt).toBe("2026-10-07T12:30:00.000Z");
    }
  });
});

describe("regression scenarios from the independent reviews", () => {
  it("C1: selling disabled names the preference; selling allowed sells 400", () => {
    // 60/40 total 2000, cash 0, threshold 5% (tolerance 100): EQUITY 1600 / BONDS 400, prices 400 / 300.
    // Targets 1200 / 800. EQUITY 400 over, one share = 400 (band 240): sell round(1.0) = 1 share = 400.
    const specs = two("1600", "400", { EQUITY: "400", BONDS: "300" });
    const blocked = size(specs, "0", "0.05", { allowSelling: false });
    expect(blocked.kind).toBe("PREFERENCE_BLOCKED");
    if (blocked.kind === "PREFERENCE_BLOCKED") {
      expect(blocked.blockers).toEqual(["SELLING_DISABLED"]);
      expect(blocked.trade.side).toBe("SELL");
      expect(blocked.trade.amount.toFixed(2)).toBe("400.00");
      expect(openOutcomeNote(blocked, "GBP").instruction).toContain("selling is disabled");
    }
    const allowed = size(specs, "0", "0.05");
    expect(allowed.kind).toBe("TRADE");
    if (allowed.kind === "TRADE") {
      expect(allowed.trade.side).toBe("SELL");
      expect(allowed.trade.exposure).toBe("EQUITY");
      expect(allowed.trade.amount.toFixed(2)).toBe("400.00");
      expect(allowed.trade.units.toString()).toBe("1");
    }
  });

  const c1r: Spec[] = [
    { exposure: "A", weight: "0.5", value: "2500", price: "2500" },
    { exposure: "B", weight: "0.5", value: "6000", price: "2000" }
  ];

  it("C1-R (A 1x2500, B 3x2000, cash 1500): selling allowed sells B x1, buys A x1, then holds at 10%", () => {
    // Targets 5000 / 5000. A 2500 under (band 1250 + 250 = 1500), B exactly 1000 over (band 1000 + 200 = 1200: at
    // target). Nothing outside a band can be sold and A needs 2500 with 1500 spendable. Funding sale: B holds 3,
    // one unit (2000) leaves B 1000 under (inside its band) and frees 1500 + 2000 = 3500 >= 2500.
    // Then A: round(1.0) = 1 share = 2500 <= 3500. End: A 5000, B 4000, cash 1000: B 1000 under (inside 1200).
    const result = run(c1r, "1500", "0.05");
    expect(result.trades).toEqual([["SELL", "B", "2000.00"], ["BUY", "A", "2500.00"]]);
    expect(result.out?.kind).toBe("HOLD");
    if (result.out?.kind === "HOLD") expect(result.out.reason).toBe("WITHIN_HALF_UNIT");
  });

  it("C1-R with selling disabled names SELLING_DISABLED (the funding sale exists)", () => {
    const out = size(c1r, "1500", "0.05", { allowSelling: false });
    expect(out.kind).toBe("PREFERENCE_BLOCKED");
    if (out.kind === "PREFERENCE_BLOCKED") {
      expect(out.blockers).toEqual(["SELLING_DISABLED"]);
      expect(out.trade.side).toBe("SELL");
      expect(out.trade.exposure).toBe("B");
      expect(outcomeReasonCode(out)).toBe("PREFERENCE_BLOCKED:SELLING_DISABLED");
    }
  });

  it("C1-R2: a cash buffer of 1600 is named where it is what blocks the pair", () => {
    // Spendable max(1500 - 1600, 0) = 0: the funding sale frees only 2000 < 2500. Without the buffer
    // 1500 + 2000 = 3500 >= 2500, so the buffer is the blocker.
    const out = size(c1r, "1500", "0.05", { cashBufferAmount: "1600" });
    expect(out.kind).toBe("PREFERENCE_BLOCKED");
    if (out.kind === "PREFERENCE_BLOCKED") expect(out.blockers).toEqual(["CASH_BUFFER"]);
  });

  it("H-A: sells one expensive A share; the sell-only variant stops within half a unit", () => {
    // A 5x980 = 4900 (4000 target, 900 over), B and C 2550 (3000 target, 450 under), cash 0, total 10000.
    // threshold 5% (tolerance 500): A 900 > band 588 -> SELL round(0.918) = 1 share = 980.
    const ha = (priceBC: string): Spec[] => [
      { exposure: "A", weight: "0.4", value: "4900", price: "980" },
      { exposure: "B", weight: "0.3", value: "2550", price: priceBC, held: "1" },
      { exposure: "C", weight: "0.3", value: "2550", price: priceBC, held: "1" }
    ];
    const five = run(ha("50"), "0", "0.05");
    expect(five.trades).toEqual([["SELL", "A", "980.00"]]);
    expect(five.out?.kind).toBe("HOLD");
    if (five.out?.kind === "HOLD") expect(five.out.reason).toBe("WITHIN_THRESHOLD");
    // threshold 2% (tolerance 200), B and C priced 2000 (band 1200): after the sale B and C are 450 under: at target.
    const two$ = run(ha("2000"), "0", "0.02");
    expect(two$.trades).toEqual([["SELL", "A", "980.00"]]);
    expect(two$.out?.kind).toBe("HOLD");
    if (two$.out?.kind === "HOLD") expect(two$.out.reason).toBe("WITHIN_HALF_UNIT");
  });

  it("H-B: sells one X and one Z share, then buys one Y share", () => {
    // Y .4 3x1000, X .3 10x320, Z .3 10x320, cash 600, total 10000, threshold 5% (tolerance 500).
    // X, Z 200 over (band 160 + 32 = 192): SELL round(0.625) = 1 share = 320 each (cash 600 -> 1240).
    // Y 1000 under (band 600): BUY round(1.0) = 1 share = 1000 <= 1240. Then X, Z are 120 under, Y on target.
    const legs: Spec[] = [
      { exposure: "Y", weight: "0.4", value: "3000", price: "1000" },
      { exposure: "X", weight: "0.3", value: "3200", price: "320" },
      { exposure: "Z", weight: "0.3", value: "3200", price: "320" }
    ];
    const result = run(legs, "600", "0.05");
    expect(result.trades).toEqual([["SELL", "X", "320.00"], ["SELL", "Z", "320.00"], ["BUY", "Y", "1000.00"]]);
    expect(result.out?.kind).toBe("HOLD");
  });

  it("H1: a pair is never pre-empted into a worse portfolio: all legs at target, no trade", () => {
    // A 7000@700 (target 6890), B 4800@600 (5390), C 4000@400 (4600), D 5000@2500 (3920), cash 0, total 20800,
    // threshold 5% (tolerance 1040). Deviations: A 110 over, B 590 under, C 600 under, D 1080 over.
    // D exceeds the tolerance but 1080 <= its band 1250 + 250 = 1500, so every leg is at target.
    const legs: SizingLeg[] = [
      { exposure: "A", current: new Decimal(7000), target: new Decimal(6890), price: new Decimal(700), buyCash: new Decimal(0), heldUnits: new Decimal(10) },
      { exposure: "B", current: new Decimal(4800), target: new Decimal(5390), price: new Decimal(600), buyCash: new Decimal(0), heldUnits: new Decimal(8) },
      { exposure: "C", current: new Decimal(4000), target: new Decimal(4600), price: new Decimal(400), buyCash: new Decimal(0), heldUnits: new Decimal(10) },
      { exposure: "D", current: new Decimal(5000), target: new Decimal(3920), price: new Decimal(2500), buyCash: new Decimal(0), heldUnits: new Decimal(2) }
    ];
    const out = sizeNextTrade({ legs, total: new Decimal(20800), threshold: new Decimal("0.05"), constraints: constraintsOf({}) });
    expect(out.kind).toBe("HOLD");
    if (out.kind === "HOLD") expect(out.reason).toBe("WITHIN_HALF_UNIT");
  });

  it("H2: the minimum trade size is a preference and is named, alone and with selling disabled", () => {
    // 50/50, A 4100 / B 5900 at 100, cash 0, threshold 5%, fractional, minimum trade 2000. 900 gaps are below it.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.5", value: "4100", price: "100" },
      { exposure: "B", weight: "0.5", value: "5900", price: "100" }
    ];
    const alone = size(specs, "0", "0.05", { fractionalShares: true, minimumTradeAmount: "2000" });
    expect(alone.kind).toBe("PREFERENCE_BLOCKED");
    if (alone.kind === "PREFERENCE_BLOCKED") expect(alone.blockers).toEqual(["MINIMUM_TRADE"]);
    const both = size(specs, "0", "0.05", { fractionalShares: true, minimumTradeAmount: "2000", allowSelling: false });
    expect(both.kind).toBe("PREFERENCE_BLOCKED");
    if (both.kind === "PREFERENCE_BLOCKED") expect(both.blockers).toEqual(["SELLING_DISABLED", "MINIMUM_TRADE"]);
  });

  it("H3a: a flat fee of 5 is not burnt on small trades", () => {
    // 50/50, A 4000 / B 6000, cash 0, threshold 0, fractional, fee 5: unit = max(0.01, 50) = 50, band = 25 + max(10, 5) = 35.
    // SELL B 1000 (cash 995, total 9995, targets 4997.50): B is 2.50 over (inside band). BUY A min(997.50, 995 - 5 = 990)
    // = 990 (cash 0, total 9990, targets 4995): A 5 under, B 5 over: at target.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.5", value: "4000", price: "100" },
      { exposure: "B", weight: "0.5", value: "6000", price: "100" }
    ];
    const result = run(specs, "0", "0", { fractionalShares: true, flatFee: "5" });
    expect(result.trades).toEqual([["SELL", "B", "1000.00"], ["BUY", "A", "990.00"]]);
    expect(result.out?.kind).toBe("HOLD");
    expect(result.cash.toFixed(2)).toBe("0.00");
  });

  const permanent: Spec[] = [
    { exposure: "A", weight: "0.25", value: "3000", price: "1000" },
    { exposure: "B", weight: "0.25", value: "3500.6", price: "0.10" },
    { exposure: "C", weight: "0.25", value: "3200.6", price: "3200.6" },
    { exposure: "D", weight: "0.25", value: "3200.6", price: "3200.6" }
  ];

  it("H3b: Permanent Portfolio with a fee of 5 does not loop small sales (whole shares)", () => {
    // total 3000 + 3500.6 + 3200.6 + 3200.6 + 1100.6 = 14002.4, targets 3500.6. A 500.6 under (band 500 + 100 = 600),
    // C and D 300 under: all within their bands, so a HOLD and no trade.
    const out = size(permanent, "1100.6", "0", { flatFee: "5" });
    expect(out.kind).toBe("HOLD");
  });

  it("H3b fractional: three purchases, no sales", () => {
    // Fee 5, unit 50, band 25 + 20 = 45. A 500.60 under: BUY 500.60 (cash 595.00, total 13997.40, targets 3499.35).
    // C 298.75 under: BUY 298.75 (cash 291.25, total 13992.40, targets 3498.10). D 297.50 under: spendable 291.25 - 5 =
    // 286.25: BUY 286.25 (cash 0). B and the others end 1.25 to 3.75 over (inside the band): no sale is ever proposed.
    const result = run(permanent, "1100.6", "0", { fractionalShares: true, flatFee: "5" });
    expect(result.trades).toEqual([["BUY", "A", "500.60"], ["BUY", "C", "298.75"], ["BUY", "D", "286.25"]]);
    expect(result.out?.kind).toBe("HOLD");
    expect(result.cash.toFixed(2)).toBe("0.00");
  });

  it("M1 multi-trade path: reports the cash needed (not 'nothing can be sold')", () => {
    // A .3 2x1000 (1000 under), D1 .25 5x550 and D2 (250 over, band 330), E .2 5x440 (200 over, band 264), cash 300.
    // Selling one D1 share (550) would free 300 + 550 = 850 < 1000, one E share 740 < 1000: no funding sale.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.3", value: "2000", price: "1000" },
      { exposure: "D1", weight: "0.25", value: "2750", price: "550" },
      { exposure: "D2", weight: "0.25", value: "2750", price: "550" },
      { exposure: "E", weight: "0.2", value: "2200", price: "440" }
    ];
    const out = size(specs, "300", "0.05");
    expect(out.kind).toBe("CASH_SHORTFALL");
    if (out.kind === "CASH_SHORTFALL") {
      expect(out.needed.toFixed(2)).toBe("1000.00");
      const note = openOutcomeNote(out, "GBP");
      expect(note.instruction).toContain("about 700.00 GBP");
      expect(note.instruction).not.toContain("nothing can be sold");
    }
  });

  it("M2: a leg outside its band whose unit exceeds its target is TOO_SMALL, not a HOLD", () => {
    // A 1 x 100, B and C none held, cash 200, total 300, weights .5/.3/.2, prices 100: targets 150 / 90 / 60.
    // Bands 60: A 50 under is inside; B 90 under is outside and its unit (100) exceeds its target (90):
    // minimum investable = 100 x 300 / 90 = 333.33.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.5", value: "100", price: "100" },
      { exposure: "B", weight: "0.3", value: "0", price: "100" },
      { exposure: "C", weight: "0.2", value: "0", price: "100" }
    ];
    const out = size(specs, "200", "0.05");
    expect(out.kind).toBe("TOO_SMALL");
    if (out.kind === "TOO_SMALL") {
      expect(out.exposure).toBe("B");
      expect(out.minimumInvestable.toFixed(2)).toBe("333.33");
    }
  });

  it("M3: sizes with the execution account's cash and holdings", () => {
    // Strategy total 1800: A target 800 (0 held, price 100), B on target. The execution account has 500 cash:
    // the nearest 8 shares (800) exceed it, so floor 8 clipped to floor(500 / 100) = 5 shares = 500.
    const buyLegs: SizingLeg[] = [
      { exposure: "A", current: new Decimal(0), target: new Decimal(800), price: new Decimal(100), buyCash: new Decimal(500), heldUnits: new Decimal(0) },
      { exposure: "B", current: new Decimal(1000), target: new Decimal(1000), price: new Decimal(100), buyCash: new Decimal(500), heldUnits: new Decimal(10) }
    ];
    const buy = sizeNextTrade({ legs: buyLegs, total: new Decimal(1800), threshold: new Decimal("0.05"), constraints: constraintsOf({}) });
    expect(buy.kind).toBe("TRADE");
    if (buy.kind === "TRADE") expect(buy.trade.amount.toFixed(2)).toBe("500.00");
    // A is 500 over (1000 vs 500) but the sale line holds only 4 of its 10 shares: SELL min(5, 4) = 4 shares = 400.
    const sellLegs: SizingLeg[] = [
      { exposure: "A", current: new Decimal(1000), target: new Decimal(500), price: new Decimal(100), buyCash: new Decimal(0), heldUnits: new Decimal(4) },
      { exposure: "B", current: new Decimal(500), target: new Decimal(1000), price: new Decimal(100), buyCash: new Decimal(0), heldUnits: new Decimal(5) }
    ];
    const sell = sizeNextTrade({ legs: sellLegs, total: new Decimal(1500), threshold: new Decimal("0.05"), constraints: constraintsOf({}) });
    expect(sell.kind).toBe("TRADE");
    if (sell.kind === "TRADE") {
      expect(sell.trade.side).toBe("SELL");
      expect(sell.trade.amount.toFixed(2)).toBe("400.00");
    }
  });

  it("M4: never buys and then sells the same leg", () => {
    // .35005 / .33 / .31995, A 3x1000, B 33x100, C 2x1300, cash 1100, fee 2, threshold 0, whole shares:
    // total 10000, targets 3500.50 / 3300 / 3199.50. A 500.50 under (band 500 + 100 = 600), C 599.50 under
    // (band 650 + 130 = 780): both inside their bands, so a HOLD and no trade at all.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.35005", value: "3000", price: "1000" },
      { exposure: "B", weight: "0.33", value: "3300", price: "100" },
      { exposure: "C", weight: "0.31995", value: "2600", price: "1300" }
    ];
    const result = run(specs, "1100", "0", { flatFee: "2" });
    expect(result.trades).toEqual([]);
    expect(result.out?.kind).toBe("HOLD");
  });

  it("M4 order: a balanced portfolio whose unit exceeds a target is a HOLD, not TOO_SMALL", () => {
    // X .2 holds 1 share at 2100 (target 2000, 100 over = 1%), Y .8 holds 39 x 200 = 7800 + cash... here Y 7900 at
    // 200 (held 39). Bands: X 1050 + 210 = 1260, Y 100 + 20 = 120 >= its 100 under: every leg at target.
    const specs: Spec[] = [
      { exposure: "X", weight: "0.2", value: "2100", price: "2100" },
      { exposure: "Y", weight: "0.8", value: "7900", price: "200", held: "39" }
    ];
    const out = size(specs, "0", "0");
    expect(out.kind).toBe("HOLD");
    if (out.kind === "HOLD") expect(out.reason).toBe("WITHIN_HALF_UNIT");
  });

  it("M-A: fractional minimum trade 50, EQUITY 5920 / BONDS 4040, cash 40, names the minimum trade", () => {
    // Targets 6000 / 4000: EQUITY 80 under, BONDS 40 over. The 40 sale and the 40 purchase (spendable 40) are
    // below the 50 minimum; with it lowered the 40 sale is permitted.
    const out = size(two("5920", "4040", { EQUITY: "100", BONDS: "40" }), "40", "0", { fractionalShares: true, minimumTradeAmount: "50" });
    expect(out.kind).toBe("PREFERENCE_BLOCKED");
    if (out.kind === "PREFERENCE_BLOCKED") {
      expect(out.blockers).toEqual(["MINIMUM_TRADE"]);
      expect(out.trade.side).toBe("SELL");
      expect(out.trade.amount.toFixed(2)).toBe("40.00");
    }
  });

  it("M-C: buys one overshooting A share and then holds inside the threshold", () => {
    // 50/50, A 4x1000 (900 under), B 12x400 = 4800 (100 under), cash 1000, total 9800, targets 4900, threshold 5%
    // (tolerance 490). A: round(0.9) = 1 share = 1000 <= 1000. Then A 100 over, B 100 under: within the threshold.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.5", value: "4000", price: "1000" },
      { exposure: "B", weight: "0.5", value: "4800", price: "400" }
    ];
    const result = run(specs, "1000", "0.05");
    expect(result.trades).toEqual([["BUY", "A", "1000.00"]]);
    expect(result.out?.kind).toBe("HOLD");
    if (result.out?.kind === "HOLD") expect(result.out.reason).toBe("WITHIN_THRESHOLD");
  });

  it("M-D: half the strategy cannot be funded: TOO_SMALL, never a HOLD", () => {
    // 50/50, total 1000: A costs 600 and none is held, B 1 x 500, cash 500. A is 500 under (band 360) and its
    // 600 unit exceeds its 500 target.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.5", value: "0", price: "600" },
      { exposure: "B", weight: "0.5", value: "500", price: "500" }
    ];
    const out = size(specs, "500", "0.05");
    expect(out.kind).toBe("TOO_SMALL");
    if (out.kind === "TOO_SMALL") {
      expect(out.exposure).toBe("A");
      expect(out.minimumInvestable.toFixed(2)).toBe("1200.00");
    }
  });

  it("M1 (3 legs): a sale too small for one share no longer blocks the review", () => {
    // 0.4 / 0.3 / 0.3, cash 0, threshold 0: A 76x50 = 3800 (200 under), B 15x210 = 3150 (150 over), C 305x10 = 3050
    // (50 over). B: round(0.714) = 1 share = 210 (B ends 60 under, inside band 126). C: 5 shares = 50. A: 4 shares = 200.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.4", value: "3800", price: "50" },
      { exposure: "B", weight: "0.3", value: "3150", price: "210" },
      { exposure: "C", weight: "0.3", value: "3050", price: "10" }
    ];
    const result = run(specs, "0", "0");
    expect(result.trades).toEqual([["SELL", "B", "210.00"], ["SELL", "C", "50.00"], ["BUY", "A", "200.00"]]);
    expect(result.out?.kind).toBe("HOLD");
  });

  it("S1b: expensive and cheap leg, cash constrained: floor first, no starvation", () => {
    // 60/40, cash 10000, EQ 3900, BD 50, threshold 0. Targets 6000 / 4000. Bands: EQ 1950 + 390 = 2340, BD 30.
    // 1. nearest EQ round(1.54) = 2 = 7800 and BD 80 = 4000 total 11800 > 10000: FLOOR: BUY EQ 1 = 3900.
    // 2. cash 6100: EQ 2100 under is inside its band; BD nearest 80 = 4000 <= 6100: BUY BD 4000.
    // 3. cash 2100: EQ 2100 under (inside band), BD on target: HOLD. (Not EQ +1800 and BD -1800 forever.)
    const specs: Spec[] = [
      { exposure: "EQ", weight: "0.6", value: "0", price: "3900" },
      { exposure: "BD", weight: "0.4", value: "0", price: "50" }
    ];
    const result = run(specs, "10000", "0");
    expect(result.trades).toEqual([["BUY", "EQ", "3900.00"], ["BUY", "BD", "4000.00"]]);
    expect(result.out?.kind).toBe("HOLD");
    if (result.out?.kind === "HOLD") expect(result.out.reason).toBe("WITHIN_HALF_UNIT");
    expect(result.cash.toFixed(2)).toBe("2100.00");
  });

  it("S3: 40/40/20, cash 5000, prices 1300 / 30 / 15: not TOO_SMALL", () => {
    // Targets 2000 / 2000 / 1000. Nearest 2 x 1300 = 2600, 67 x 30 = 2010, 67 x 15 = 1005 total 5615 > 5000: FLOOR:
    // BUY A 1 = 1300. cash 3700: nearest 2010 + 1005 = 3015 <= 3700: BUY B 67 = 2010, then BUY C 67 = 1005.
    // Cash 685: A 700 under (band 780), B 10 over (18), C 5 over (9): HOLD.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.4", value: "0", price: "1300" },
      { exposure: "B", weight: "0.4", value: "0", price: "30" },
      { exposure: "C", weight: "0.2", value: "0", price: "15" }
    ];
    const result = run(specs, "5000", "0");
    expect(result.trades).toEqual([["BUY", "A", "1300.00"], ["BUY", "B", "2010.00"], ["BUY", "C", "1005.00"]]);
    expect(result.out?.kind).toBe("HOLD");
    expect(result.cash.toFixed(2)).toBe("685.00");
  });

  it("T2: a half-cent deposit converges instead of printing a negative amount", () => {
    // 50/50, deposit 10000.01, price 100, fractional, threshold 0: targets 5000.005 each. BUY 5000.00 (half-down),
    // BUY 5000.00; each leg is then 0.005 under: inside the inclusive band 0.005 + 0.001 = 0.006: HOLD.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.5", value: "0", price: "100" },
      { exposure: "B", weight: "0.5", value: "0", price: "100" }
    ];
    const result = run(specs, "10000.01", "0", { fractionalShares: true });
    expect(result.trades).toEqual([["BUY", "A", "5000.00"], ["BUY", "B", "5000.00"]]);
    expect(result.out?.kind).toBe("HOLD");
    expect(result.cash.toFixed(2)).toBe("0.01");
  });

  it("R1: price moves between fills with zero fees give at most one trade per leg", () => {
    // 50/50, cash 10000. Price of A per step: 100, 100.05 (+0.05%), 99.95, 100; B 100.
    // 1. BUY A 50 x 100 = 5000. 2. A is 5002.50, total 10002.50, B target 5001.25: BUY B 50 = 5000.
    // 3. A 99.95 x 50 = 4997.50, B 5000, total 9997.50: both 1.25 off, inside band 60 + ...: HOLD.
    const path = ["100", "100.05", "99.95", "100"];
    let unitsA = new Decimal(0);
    let unitsB = new Decimal(0);
    let cash = new Decimal(10000);
    const trades: Array<[string, string, string]> = [];
    let last: SizingOutcome | null = null;
    for (let i = 0; i < path.length; i += 1) {
      const pA = new Decimal(path[i]);
      const specs: Spec[] = [
        { exposure: "A", weight: "0.5", value: unitsA.mul(pA).toString(), price: pA.toString(), held: unitsA.toString() },
        { exposure: "B", weight: "0.5", value: unitsB.mul(100).toString(), price: "100", held: unitsB.toString() }
      ];
      last = size(specs, cash.toString(), "0");
      if (last.kind !== "TRADE") break;
      const t = last.trade;
      const signed = t.side === "BUY" ? t.amount : t.amount.neg();
      const price = t.exposure === "A" ? pA : new Decimal(100);
      const units = t.amount.div(price);
      if (t.exposure === "A") unitsA = unitsA.plus(t.side === "BUY" ? units : units.neg());
      else unitsB = unitsB.plus(t.side === "BUY" ? units : units.neg());
      cash = cash.minus(signed);
      trades.push([t.side, t.exposure, t.amount.toFixed(2)]);
    }
    expect(trades).toEqual([["BUY", "A", "5000.00"], ["BUY", "B", "5000.00"]]);
    expect(last?.kind).toBe("HOLD");
  });
});

describe("termination", () => {
  const portfolios: Array<{ name: string; specs: Spec[]; cash: string; threshold: string; c: Constraints }> = [
    { name: "headline whole shares", specs: two("0", "0"), cash: "10000", threshold: "0", c: {} },
    // Fee 2: BUY EQUITY 68 (floor, cash 4061.60); BUY BONDS 95 (cash 98.10); then EQUITY 87.30 (cash 8.80). BONDS 36.10
    // under (< 41.70, outside band 25.02), spendable 6.80: HOLD within one unit.
    { name: "headline whole shares with fee 2", specs: two("0", "0"), cash: "10000", threshold: "0", c: { flatFee: "2" } },
    {
      name: "fee 5, fractional, 50/50", cash: "0", threshold: "0", c: { fractionalShares: true, flatFee: "5" },
      specs: [{ exposure: "A", weight: "0.5", value: "4000", price: "100" }, { exposure: "B", weight: "0.5", value: "6000", price: "100" }]
    },
    {
      name: "permanent portfolio fractional with fee", cash: "1100.6", threshold: "0", c: { fractionalShares: true, flatFee: "5" },
      specs: [
        { exposure: "A", weight: "0.25", value: "3000", price: "1000" },
        { exposure: "B", weight: "0.25", value: "3500.6", price: "0.10" },
        { exposure: "C", weight: "0.25", value: "3200.6", price: "3200.6" },
        { exposure: "D", weight: "0.25", value: "3200.6", price: "3200.6" }
      ]
    },
    {
      name: "3 legs whole shares with fee 2", cash: "0", threshold: "0", c: { flatFee: "2" },
      specs: [
        { exposure: "A", weight: "0.4", value: "3800", price: "50" },
        { exposure: "B", weight: "0.3", value: "3150", price: "210" },
        { exposure: "C", weight: "0.3", value: "3050", price: "10" }
      ]
    },
    {
      name: "fractional with a minimum trade of 25", cash: "7777.77", threshold: "0", c: { fractionalShares: true, minimumTradeAmount: "25" },
      specs: two("0", "0")
    },
    {
      name: "expensive leg and cheap leg", cash: "10000", threshold: "0", c: {},
      specs: [{ exposure: "EQ", weight: "0.6", value: "0", price: "3900" }, { exposure: "BD", weight: "0.4", value: "0", price: "50" }]
    }
  ];

  for (const p of portfolios) {
    it("ends within 12 steps without a round trip: " + p.name, () => {
      const result = run(p.specs, p.cash, p.threshold, p.c, 12);
      expect(result.exhausted).toBe(false);
      expect(result.trades.length).toBeLessThanOrEqual(8);
      // No leg is bought and sold (or sold and bought) in the same review.
      for (const exposure of new Set(result.trades.map((t) => t[1]))) {
        const sides = new Set(result.trades.filter((t) => t[1] === exposure).map((t) => t[0]));
        expect(sides.size).toBe(1);
      }
      expect(result.cash.gte(0)).toBe(true);
      expect(["HOLD", "CASH_SHORTFALL", "PREFERENCE_BLOCKED", "TOO_SMALL", "NOTHING_TO_SELL"]).toContain(result.out?.kind);
    });
  }
});

describe("one-unit exception and small details", () => {
  it("an in-band overweight sale that would fund a unit is proposed instead of closing", () => {
    // 50/50, A 4890 @100 (110 under, outside band 60), B 5060 @120 (42 shares, 60 over = inside band 72), cash 50,
    // total 10000, threshold 0. Spendable 50 < 100. Selling one B share (120) leaves B 60 under (inside band) and
    // frees 50 + 120 = 170 >= 100: SELL B 120 first; then BUY A round(1.1) = 1 share = 100 (A 10 under, B 60
    // under, cash 70): HOLD.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.5", value: "4890", price: "100" },
      { exposure: "B", weight: "0.5", value: "5060", price: "120", held: "42" }
    ];
    const first = size(specs, "50", "0");
    expect(first.kind).toBe("TRADE");
    if (first.kind === "TRADE") {
      expect(first.trade.side).toBe("SELL");
      expect(first.trade.exposure).toBe("B");
      expect(first.trade.amount.toFixed(2)).toBe("120.00");
    }
    const result = run(specs, "50", "0");
    expect(result.trades).toEqual([["SELL", "B", "120.00"], ["BUY", "A", "100.00"]]);
    expect(result.out?.kind).toBe("HOLD");
    if (result.out?.kind === "HOLD") expect(result.out.reason).toBe("WITHIN_HALF_UNIT");
    expect(result.cash.toFixed(2)).toBe("70.00");
  });

  it("a cash buffer that is what blocks the purchase stays DATA_REQUIRED, not a HOLD", () => {
    // 50/50, A and B 4930 @100, cash 140, total 10000, targets 5000: both 70 under (band 60). Buffer 50: spendable 90
    // < 100. Without the buffer 140 buys one share: PREFERENCE_BLOCKED [CASH_BUFFER].
    const specs: Spec[] = [
      { exposure: "A", weight: "0.5", value: "4930", price: "100" },
      { exposure: "B", weight: "0.5", value: "4930", price: "100" }
    ];
    const out = size(specs, "140", "0", { cashBufferAmount: "50" });
    expect(out.kind).toBe("PREFERENCE_BLOCKED");
    if (out.kind === "PREFERENCE_BLOCKED") expect(out.blockers).toEqual(["CASH_BUFFER"]);
  });

  it("fractional mode never uses the one-unit exception", () => {
    // The headline end state in fractional mode: EQUITY 23.70 over is inside the 0.25%-of-portfolio band (25.00),
    // BONDS 38.50 under is outside it and is bought with the 14.80 of cash.
    const out = size(two("6023.70", "3961.50"), "14.80", "0", { fractionalShares: true });
    expect(out.kind).toBe("TRADE");
    if (out.kind === "TRADE") {
      expect(out.trade.side).toBe("BUY");
      expect(out.trade.exposure).toBe("BONDS");
      expect(out.trade.amount.toFixed(2)).toBe("14.80");
    }
  });

  it("sizedTradeRows states the undershoot truthfully", () => {
    const out = size(two("0", "0"), "10000", "0");
    expect(out.kind).toBe("TRADE");
    if (out.kind === "TRADE") {
      const rows = sizedTradeRows(out.trade, "GBP", false);
      expect(rows[0].value).toContain("exact gap 6000.00 GBP, order 5936.40 GBP (undershoots by 63.60 GBP)");
    }
  });

  it("sub-penny fractional residue is a HOLD, never a micro-trade", () => {
    // EQUITY 68.728522 x 87.30 = 5999.9999706, BONDS 95.923261 x 41.70 = 3999.9999837, cash 0.0000457.
    const equity = new Decimal("68.728522").mul("87.30");
    const bonds = new Decimal("95.923261").mul("41.70");
    const cash = new Decimal(10000).minus(equity).minus(bonds);
    const out = size(two(equity.toString(), bonds.toString()), cash.toString(), "0", { fractionalShares: true });
    expect(out.kind).toBe("HOLD");
    const engine = fixedAllocationEngine.calculate({
      strategyInstanceId: "i", strategyVersionId: "v", now: new Date("2026-10-07T12:00:00Z"), baseCurrency: "GBP", cash,
      exposures: [{ economicExposure: "EQUITY", value: equity }, { economicExposure: "BONDS", value: bonds }],
      contributionsSinceReview: new Decimal(0), state: {}, settings: {},
      config: { allocations: [{ exposure: "EQUITY", weight: "0.6" }, { exposure: "BONDS", weight: "0.4" }], rebalanceThreshold: "0" },
      reviewDue: true, dataHealth: { status: "CURRENT" as const }
    });
    expect(engine.actionType).toBe("HOLD");
  });

  it("an unpriced leg fails closed", () => {
    const { sizing, total } = build(two("5000", "4000"), "1000");
    sizing[0] = { ...sizing[0], price: null };
    const out = sizeNextTrade({ legs: sizing, total, threshold: new Decimal("0.05"), constraints: constraintsOf({}) });
    expect(out.kind).toBe("UNPRICED");
  });

  it("N1: an unheld whole-share leg whose unit exceeds its target is TOO_SMALL, not 'within half a unit'", () => {
    // 50/50 total 1000: A costs 900 and none is held (target 500), B 1 x 500, cash 500, threshold 5%.
    // A: 0 < 50% of 500, 900 > 500 -> TOO_SMALL, unit 900, minimum investable 900 x 1000 / 500 = 1800.
    const a: Spec[] = [
      { exposure: "A", weight: "0.5", value: "0", price: "900" },
      { exposure: "B", weight: "0.5", value: "500", price: "500" }
    ];
    const first = size(a, "500", "0.05");
    expect(first.kind).toBe("TOO_SMALL");
    if (first.kind === "TOO_SMALL") {
      expect(first.exposure).toBe("A");
      expect(first.unitPrice.toFixed(2)).toBe("900.00");
      expect(first.minimumInvestable.toFixed(2)).toBe("1800.00");
      expect(openOutcomeNote(first, "GBP").instruction).toContain("one unit costs 900.00 GBP");
    }
    // Golden-butterfly-like: total 2000, a 20% leg (target 400) costs 700 and nothing is held; Y holds its 1600.
    const b: Spec[] = [
      { exposure: "X", weight: "0.2", value: "0", price: "700" },
      { exposure: "Y", weight: "0.8", value: "1600", price: "100" }
    ];
    const second = size(b, "400", "0.05");
    expect(second.kind).toBe("TOO_SMALL");
    if (second.kind === "TOO_SMALL") expect(second.minimumInvestable.toFixed(2)).toBe("3500.00");
  });

  it("N3: a funding sale that would worsen the worst leg is not made", () => {
    // total 10000, cash 400: A and B 2400 @600 (600 under each), D 4800 @1900 (2 held, 800 over), threshold 5%.
    // Selling one D share (1900) leaves D 1100 under and buying A leaves B 600 under: worst 800 -> 1100.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.3", value: "2400", price: "600" },
      { exposure: "B", weight: "0.3", value: "2400", price: "600" },
      { exposure: "D", weight: "0.4", value: "4800", price: "1900", held: "2" }
    ];
    const out = size(specs, "400", "0.05");
    expect(out.kind).toBe("CASH_SHORTFALL");
    if (out.kind === "CASH_SHORTFALL") {
      expect(out.exposure).toBe("A");
      expect(out.needed.toFixed(2)).toBe("600.00");
    }
  });

  it("N2: fractional with a fee and several legs: in-band overweight covers the underweight gap, HOLD", () => {
    // 4 x 25% at 10000, cash 0: A, B, C 33 / 33 / 34 over, D 100 under; fee 5, unit 50, band 45 (> 0.25% = 25).
    const mk = (exposure: string, current: number, held: number): SizingLeg => ({
      exposure, current: new Decimal(current), target: new Decimal(2500), price: new Decimal(100), buyCash: new Decimal(0), heldUnits: new Decimal(held)
    });
    const out = sizeNextTrade({
      legs: [mk("A", 2533, 25), mk("B", 2533, 25), mk("C", 2534, 25), mk("D", 2400, 24)],
      total: new Decimal(10000), threshold: new Decimal(0),
      constraints: constraintsOf({ fractionalShares: true, flatFee: "5" })
    });
    expect(out.kind).toBe("HOLD");
    if (out.kind === "HOLD") expect(out.reason).toBe("WITHIN_HALF_UNIT");
  });

  it("P1: fractional, no fee: in-band excess is sold to fund the short leg (no free HOLD at 13% short)", () => {
    // All Weather 30/40/15/7.5/7.5, total 100000, fractional, fee 0, cash 0, threshold 0, band 0.25% = 250.
    // A, B, C and E are +240 each (inside the band), gold D is 960 short (6540 vs 7500).
    // Cash 0 < 960 - 250 = 710: SELL A 240, SELL B 240, SELL C 240 (cash 720 >= 710), then BUY D 720 (gap 240 <=
    // 250); E +240 and D -240 are inside the band: HOLD. Worst deviation 960 -> 720 -> 480 -> 240 each time.
    const specs: Spec[] = [
      { exposure: "A", weight: "0.3", value: "30240", price: "100" },
      { exposure: "B", weight: "0.4", value: "40240", price: "100" },
      { exposure: "C", weight: "0.15", value: "15240", price: "100" },
      { exposure: "D", weight: "0.075", value: "6540", price: "100" },
      { exposure: "E", weight: "0.075", value: "7740", price: "100" }
    ];
    const result = run(specs, "0", "0", { fractionalShares: true });
    expect(result.trades).toEqual([["SELL", "A", "240.00"], ["SELL", "B", "240.00"], ["SELL", "C", "240.00"], ["BUY", "D", "720.00"]]);
    expect(result.out?.kind).toBe("HOLD");
    expect(result.cash.toFixed(2)).toBe("0.00");
  });

  it("P1 with selling disabled names the preference instead of closing", () => {
    const specs: Spec[] = [
      { exposure: "A", weight: "0.3", value: "30240", price: "100" },
      { exposure: "B", weight: "0.4", value: "40240", price: "100" },
      { exposure: "C", weight: "0.15", value: "15240", price: "100" },
      { exposure: "D", weight: "0.075", value: "6540", price: "100" },
      { exposure: "E", weight: "0.075", value: "7740", price: "100" }
    ];
    const out = size(specs, "0", "0", { fractionalShares: true, allowSelling: false });
    expect(out.kind).toBe("PREFERENCE_BLOCKED");
    if (out.kind === "PREFERENCE_BLOCKED") expect(out.blockers).toEqual(["SELLING_DISABLED"]);
  });

  it("N4: another leg's +/-2% price moves between reviews do not start a sale/purchase cycle", () => {
    // 55/45, E at 100 / 102 alternating, B at 10, whole shares, threshold 0, cash 10000.
    // 1. BUY E 55 = 5500. 2. E 102: E 5610, total 10110; B target 4549.50: floor purchase 450 units = 4500.
    // 3. E 100: on target: HOLD. 4. E 102 again: E 49.50 over (inside 61.20), B 49.50 under (outside 25.28), cash
    //    0; selling one E share (102) to buy 5 B would leave E 52.50 off target (> 49.50): not allowed. No trade.
    let unitsE = new Decimal(0);
    let unitsB = new Decimal(0);
    let cash = new Decimal(10000);
    const trades: Array<[string, string, string]> = [];
    const kinds: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const pE = new Decimal(i % 2 === 0 ? "100" : "102");
      const specs: Spec[] = [
        { exposure: "E", weight: "0.55", value: unitsE.mul(pE).toString(), price: pE.toString(), held: unitsE.toString() },
        { exposure: "B", weight: "0.45", value: unitsB.mul(10).toString(), price: "10", held: unitsB.toString() }
      ];
      const out = size(specs, cash.toString(), "0");
      kinds.push(out.kind);
      if (out.kind !== "TRADE") continue;
      const t = out.trade;
      const signed = t.side === "BUY" ? t.amount : t.amount.neg();
      const units = t.amount.div(t.exposure === "E" ? pE : new Decimal(10));
      if (t.exposure === "E") unitsE = unitsE.plus(t.side === "BUY" ? units : units.neg());
      else unitsB = unitsB.plus(t.side === "BUY" ? units : units.neg());
      cash = cash.minus(signed);
      trades.push([t.side, t.exposure, t.amount.toFixed(2)]);
    }
    expect(trades).toEqual([["BUY", "E", "5500.00"], ["BUY", "B", "4500.00"]]);
    expect(kinds.slice(2)).toEqual(["HOLD", "CASH_SHORTFALL", "HOLD", "CASH_SHORTFALL", "HOLD", "CASH_SHORTFALL"]);
  });

  it("never plans an order that rounds to 0.00", () => {
    const tiny = planPracticalTrade({ side: "BUY", proposedAmount: "0.004", price: "87.30", availableCash: "10", heldQuantity: "0", constraints: { fractionalShares: true } });
    expect(tiny).toMatchObject({ status: "BLOCKED", reason: "BELOW_MINIMUM_TRADE" });
    const edge = planPracticalTrade({ side: "BUY", proposedAmount: "0.005", price: "100", availableCash: "10", heldQuantity: "0", constraints: { fractionalShares: true } });
    expect(edge.status).toBe("EXECUTABLE");
    expect(SMALLEST_TRADE_UNIT.toString()).toBe("0.005");
  });
});
