import {describe, expect, it} from "vitest";
import {projectGrowthSig} from "../src/domain/strategy/sig-research";

describe("source-confirmed growth Sig mathematics (research only)", () => {
  it.each([
    ["3sig", "1030"],
    ["6sig", "1060"],
    ["9sig", "1090"],
  ] as const)("compounds one quarter for %s independently", (variant, expected) => {
    const result = projectGrowthSig({variant, precedingAnchor:"1000",newCash:"0",observedExposure:"1000"});
    expect(result.target).toBe(expected);
    expect(result.indicativeDirection).toBe("BUY");
  });

  it("reproduces Kelly's published 9Sig contribution example, not an invented execution rule", () => {
    const q1 = projectGrowthSig({variant:"9sig",precedingAnchor:"63000",newCash:"10700",observedExposure:"84020"});
    expect(q1.baseTarget).toBe("68670");
    expect(q1.contributionIncrement).toBe("5350");
    expect(q1.target).toBe("74020");
    expect(q1.gap).toBe("-10000");
    expect(q1.indicativeDirection).toBe("SELL");
    const q2 = projectGrowthSig({variant:"9sig",precedingAnchor:q1.target,newCash:"12800",observedExposure:"67358"});
    expect(q2.target).toBe("87081.8");
    expect(q2.gap).toBe("19723.8");
    expect(q2.indicativeDirection).toBe("BUY");
  });

  it("preserves fractional precision and handles exact equality", () => {
    const r = projectGrowthSig({variant:"3sig",precedingAnchor:"0.01",newCash:"0.01",observedExposure:"0.0153"});
    expect(r.target).toBe("0.0153");
    expect(r.indicativeDirection).toBe("HOLD");
  });

  it("rejects invalid state instead of inventing a decision", () => {
    expect(() => projectGrowthSig({variant:"9sig",precedingAnchor:"-1",newCash:"0",observedExposure:"0"})).toThrow("INVALID_SIG_INPUT");
    expect(() => projectGrowthSig({variant:"6sig",precedingAnchor:"1",newCash:"NaN",observedExposure:"0"})).toThrow("INVALID_SIG_INPUT");
    expect(() => projectGrowthSig({variant:"not-a-sig" as "9sig",precedingAnchor:"1",newCash:"0",observedExposure:"0"})).toThrow("INVALID_SIG_VARIANT");
  });
});
