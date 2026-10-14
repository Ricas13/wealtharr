import { describe, expect, it } from "vitest";
import { corporateActionIssue, corporateActionRequestSchema, isPowerOfTenRatio, reduceRatio, requiresSecondAdmin } from "@/domain/corporate-action-input";

const base = {
  action: "create" as const,
  instrumentId: "00000000-0000-4000-8000-000000000001",
  ratioTo: 2,
  ratioFrom: 1,
  effectiveDate: "2026-10-12",
  evidence: { sourceUrl: "https://example.test/notice", retrievedAt: "2026-10-13", note: "Compared the issuer notice with the exchange page." }
};
const parse = (value: unknown) => corporateActionRequestSchema.parse(value);

describe("corporate action ratios", () => {
  it("reduces to lowest terms", () => {
    expect(reduceRatio(4, 2)).toEqual({ to: 2, from: 1 });
    expect(reduceRatio(3, 2)).toEqual({ to: 3, from: 2 });
    expect(reduceRatio(20, 200)).toEqual({ to: 1, from: 10 });
  });
  it("flags powers of ten in either direction, after reduction", () => {
    for (const [to, from] of [[10, 1], [100, 1], [1000, 1], [1, 10], [1, 100], [1, 1000], [20, 2], [5, 50]]) {
      expect(isPowerOfTenRatio(to, from), `${to}:${from}`).toBe(true);
    }
    for (const [to, from] of [[2, 1], [3, 2], [1, 3], [5, 1], [20, 1], [1, 20]]) {
      expect(isPowerOfTenRatio(to, from), `${to}:${from}`).toBe(false);
    }
  });
});

describe("corporateActionIssue", () => {
  const today = "2026-10-14";
  it("accepts an ordinary 2:1 split", () => {
    expect(corporateActionIssue(parse(base), today)).toBeNull();
  });
  it("refuses a future effective date and a future retrieval date", () => {
    expect(corporateActionIssue(parse({ ...base, effectiveDate: "2026-10-15" }), today)).toMatch(/future/);
    expect(corporateActionIssue(parse({ ...base, evidence: { ...base.evidence, retrievedAt: "2026-10-15" } }), today)).toMatch(/future/);
  });
  it("needs the confirmation and a unit/currency note for a power-of-ten ratio", () => {
    const risky = { ...base, ratioTo: 100, ratioFrom: 1 };
    expect(corporateActionIssue(parse(risky), today)).toMatch(/power of ten/);
    expect(corporateActionIssue(parse({ ...risky, confirmPowerOfTenRisk: true }), today)).toMatch(/currency or unit/);
    const withNote = { ...risky, confirmPowerOfTenRisk: true, evidence: { ...base.evidence, note: "Checked the currency: pounds not pence, per the issuer notice." } };
    expect(corporateActionIssue(parse(withNote), today)).toBeNull();
    // Long enough but with no mention of the currency or unit check.
    const vague = { ...risky, confirmPowerOfTenRisk: true, evidence: { ...base.evidence, note: "Read the announcement carefully and it looks right to me." } };
    expect(corporateActionIssue(parse(vague), today)).toMatch(/currency or unit/);
  });
  it("refuses a ratio that does not change the units", () => {
    expect(corporateActionIssue(parse({ ...base, ratioTo: 2, ratioFrom: 2 }), today)).toMatch(/change the number of units/);
  });
});

describe("requiresSecondAdmin", () => {
  it("is true for powers of ten and for any reduced term above 50, either way", () => {
    for (const [to, from] of [[10, 1], [100, 1], [1, 10], [1, 1000], [51, 1], [1, 51], [200, 2], [3, 200], [60, 7]]) {
      expect(requiresSecondAdmin(to, from), `${to}:${from}`).toBe(true);
    }
  });
  it("is false for ordinary ratios, including a non-reduced one that reduces to one", () => {
    for (const [to, from] of [[2, 1], [3, 2], [1, 3], [5, 1], [20, 1], [50, 1], [1, 50], [100, 50], [4, 2]]) {
      expect(requiresSecondAdmin(to, from), `${to}:${from}`).toBe(false);
    }
  });
});
