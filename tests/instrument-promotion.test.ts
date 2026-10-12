import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isValidIsin } from "../src/domain/instrument-import";
import {
  classifyPromotion, promoteMappingSchema, rejectMappingSchema, subjectMatchesMapping, type PeerMapping
} from "../src/domain/instrument-promotion";

const MAPPING_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_LINE_ID = "33333333-3333-4333-8333-333333333333";
const subject = { economicExposure: "BROAD_EQUITY", leverage: "1", direction: "LONG", country: "GB", wrapper: "ISA", tradingLineId: LINE_ID };
const checklist = {
  factsheetChecked: true, underlyingMatchesExposure: true, leverageAndDirectionMatch: true,
  listingCurrencyAndExchangeCorrect: true, wrapperAndCountryEligible: true
};
const base = { kind: "promote", mappingId: MAPPING_ID, isin: "US0378331005", checklist, subject, note: "Checked the issuer KID and factsheet on the issuer site." };

describe("ISIN validation (ISO 6166, Luhn over the expanded digits)", () => {
  it("accepts valid ISINs", () => {
    expect(isValidIsin("US0378331005")).toBe(true);
    // AU0000XVGZA3 expands to 10 30 000000 33 31 16 35 10; Luhn over those 20 digits gives check digit 3.
    expect(isValidIsin("AU0000XVGZA3")).toBe(true);
  });
  it("rejects bad length, charset and check digit", () => {
    expect(isValidIsin("AU0000XVGZA4")).toBe(false);
    expect(isValidIsin("US037833100")).toBe(false);
    expect(isValidIsin("US03783310055")).toBe(false);
    expect(isValidIsin("US03783310-5")).toBe(false);
    expect(isValidIsin("1S0378331005")).toBe(false);
    expect(isValidIsin("us0378331005")).toBe(false);
    expect(isValidIsin("US037833100A")).toBe(false);
    expect(isValidIsin("")).toBe(false);
  });
});

describe("promotion input", () => {
  it("accepts a complete verification and normalises the ISIN", () => {
    const parsed = promoteMappingSchema.parse({ ...base, isin: " us0378331005 " });
    expect(parsed.isin).toBe("US0378331005");
  });
  it("refuses when any checklist item is false or missing", () => {
    for (const key of Object.keys(checklist)) {
      expect(promoteMappingSchema.safeParse({ ...base, checklist: { ...checklist, [key]: false } }).success, key).toBe(false);
      const { [key]: _omitted, ...rest } = checklist as Record<string, boolean>;
      expect(promoteMappingSchema.safeParse({ ...base, checklist: rest }).success, key + " missing").toBe(false);
    }
    expect(promoteMappingSchema.safeParse({ ...base, checklist: { ...checklist, factsheetChecked: "true" } }).success).toBe(false);
  });
  it("refuses a malformed ISIN, a short note and an unknown checklist item", () => {
    expect(promoteMappingSchema.safeParse({ ...base, isin: "US0378331006" }).success).toBe(false);
    expect(promoteMappingSchema.safeParse({ ...base, isin: "" }).success).toBe(false);
    expect(promoteMappingSchema.safeParse({ ...base, note: "ok" }).success).toBe(false);
    expect(promoteMappingSchema.safeParse({ ...base, note: "                              " }).success).toBe(false);
    expect(promoteMappingSchema.safeParse({ ...base, checklist: { ...checklist, extra: true } }).success).toBe(false);
  });
  it("requires a note to reject", () => {
    expect(rejectMappingSchema.safeParse({ kind: "reject", mappingId: MAPPING_ID, note: "short" }).success).toBe(false);
    expect(rejectMappingSchema.safeParse({ kind: "reject", mappingId: MAPPING_ID, note: "Wrong index: tracks a different benchmark." }).success).toBe(true);
  });
});

describe("subject re-validation and ambiguity", () => {
  const row = { economicExposure: "BROAD_EQUITY", leverage: "1.000000", direction: "LONG", country: "GB", wrapper: "ISA", tradingLineId: LINE_ID };
  it("compares leverage numerically and every other field exactly", () => {
    expect(subjectMatchesMapping({ ...subject, direction: "LONG" } as never, row)).toBe(true);
    expect(subjectMatchesMapping({ ...subject, leverage: "2" } as never, row)).toBe(false);
    expect(subjectMatchesMapping({ ...subject, direction: "SHORT" } as never, row)).toBe(false);
    expect(subjectMatchesMapping({ ...subject, economicExposure: "GOLD" } as never, row)).toBe(false);
    expect(subjectMatchesMapping({ ...subject, tradingLineId: OTHER_LINE_ID } as never, row)).toBe(false);
    expect(subjectMatchesMapping({ ...subject, wrapper: "SIPP" } as never, row)).toBe(false);
  });
  const candidate: PeerMapping = { id: MAPPING_ID, economicExposure: "BROAD_EQUITY", leverage: "1.000000", direction: "LONG", country: "GB", wrapper: "ISA", broker: null, preferredCurrency: "GBP", tradingLineId: LINE_ID, effectiveFrom: "2026-01-01", effectiveTo: null };
  const peer = (over: Partial<PeerMapping>): PeerMapping => ({ ...candidate, id: "44444444-4444-4444-8444-444444444444", ...over });
  it("allows an empty or unrelated peer set", () => {
    expect(classifyPromotion(candidate, [])).toBe("OK");
    expect(classifyPromotion(candidate, [peer({ country: "US" }), peer({ wrapper: "SIPP" }), peer({ broker: "other" }), peer({ preferredCurrency: "USD" })])).toBe("OK");
  });
  it("refuses a different trading line with the same lookup key, even with another start date", () => {
    expect(classifyPromotion(candidate, [peer({ tradingLineId: OTHER_LINE_ID })])).toBe("AMBIGUOUS_MAPPING");
    expect(classifyPromotion(candidate, [peer({ tradingLineId: OTHER_LINE_ID, effectiveFrom: "2025-01-01" })])).toBe("AMBIGUOUS_MAPPING");
    expect(classifyPromotion(candidate, [peer({ tradingLineId: OTHER_LINE_ID, leverage: "1" })])).toBe("AMBIGUOUS_MAPPING");
  });
  it("ignores a peer whose validity ended before the candidate starts", () => {
    expect(classifyPromotion(candidate, [peer({ tradingLineId: OTHER_LINE_ID, effectiveTo: "2025-12-31" })])).toBe("OK");
  });
  it("flags an overlapping duplicate on the same trading line", () => {
    expect(classifyPromotion(candidate, [peer({})])).toBe("DUPLICATE_MAPPING");
  });
});

describe("promotion route and service source", () => {
  const route = readFileSync("src/app/api/admin/instruments/route.ts", "utf8");
  const service = readFileSync("src/lib/instrument-promotion.ts", "utf8");
  it("checks origin, then admin, before reading the body", () => {
    const origin = route.indexOf("assertSameOrigin(request)");
    const admin = route.indexOf("await requireAdmin()");
    const body = route.indexOf("await request.json()");
    expect(origin).toBeGreaterThan(-1);
    expect(origin).toBeLessThan(admin);
    expect(admin).toBeLessThan(body);
    expect(route).toContain("authFailure(error)");
    expect(route).toContain("promoteCandidateMapping(admin.id");
  });
  it("promotes and rejects only inside a transaction that audits and locks", () => {
    expect(service.match(/sql\.begin\(/g)?.length).toBe(4);
    expect(service).toContain("pg_advisory_xact_lock");
    expect(service).toContain("FOR UPDATE OF m");
    expect(service).toContain("fidelity='CANDIDATE'");
    expect(service).toContain("'instrument-mapping.promoted'");
    expect(service).toContain("'instrument-mapping.rejected'");
    expect(service).toContain("INSERT INTO audit_events");
  });
  it("has no path that writes a verified mapping except promoteCandidateMapping", () => {
    expect(route).not.toContain("'EXACT'");
    expect(route).not.toMatch(/(INSERT|UPDATE)[^;]*EXACT/);
    expect(route).toContain("insertCandidateMapping(");
    // The only statement that sets fidelity EXACT sits inside promoteCandidateMapping.
    expect(service.match(/fidelity='EXACT'/g)?.length).toBeGreaterThan(0);
    const writes = service.match(/(INSERT INTO regional_instrument_mappings|UPDATE regional_instrument_mappings SET fidelity='EXACT')[^"]*/g) ?? [];
    expect(writes.filter((w) => w.includes("'EXACT'"))).toHaveLength(1);
    const promoteStart = service.indexOf("export async function promoteCandidateMapping");
    const promoteEnd = service.indexOf("const VERIFIED_ON_INSTRUMENT");
    const exactSet = service.indexOf("SET fidelity='EXACT'");
    expect(exactSet).toBeGreaterThan(promoteStart);
    expect(exactSet).toBeLessThan(promoteEnd);
    expect(service).toMatch(/'CANDIDATE',\$9,\$10,false\)/);
  });
  it("guards verified instruments and trading lines and the import script", () => {
    expect(service).toContain("INSTRUMENT_IN_USE");
    expect(service).toContain("TRADING_LINE_IN_USE");
    expect(route).toContain("updateInstrumentGuarded(");
    expect(route).toContain("upsertTradingLineGuarded(");
    const script = readFileSync("scripts/import-instruments.ts", "utf8");
    expect(script).toContain("ON CONFLICT (exchange,ticker,effective_from) DO NOTHING");
    expect(script).not.toMatch(/trading_lines[^"]*DO UPDATE/);
  });
  it("makes unverified the database default", () => {
    const migration = readFileSync("db/migrations/0037_instrument_mapping_fidelity_guard.sql", "utf8");
    expect(migration).toContain("SET DEFAULT 'CANDIDATE'");
    expect(migration).toContain("pg_constraint");
    expect(migration).toContain("NOT VALID");
  });
  it("never promotes from the import script or any automatic path", () => {
    const script = readFileSync("scripts/import-instruments.ts", "utf8");
    expect(script).not.toContain("'EXACT'");
  });
});
