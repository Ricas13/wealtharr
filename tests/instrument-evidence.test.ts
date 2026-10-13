import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canonicalEvidenceJson, purchasabilityEvidence, requiresCompleteEvidence, validateInstrumentEvidence, type EvidenceContext
} from "../src/domain/instrument-evidence";
import { promoteMappingSchema } from "../src/domain/instrument-promotion";
import { resolveMapping } from "../src/domain/instruments";

const TODAY = "2026-10-13";
const HASH = "a".repeat(64);
const ctx: EvidenceContext = {
  country: "GB", wrapper: "ISA", broker: null, today: TODAY,
  tradingLine: { exchange: "LSE", ticker: "TEST", currency: "GBP" }
};
const complete = {
  kidUrl: "https://issuer.example/kid.pdf", kidRetrievedAt: "2026-10-01", kidSha256: HASH,
  isaEligibility: { basis: "UCITS_OR_AUTHORISED_FUND", sourceUrl: "https://www.gov.uk/guidance/example", checkedAt: "2026-10-02" },
  listingEvidence: { exchange: "LSE", ticker: "TEST", currency: "GBP" }
};
const issuesOf = (raw: unknown, over: Partial<EvidenceContext> = {}) => {
  const r = validateInstrumentEvidence(raw, { ...ctx, ...over });
  return r.ok ? [] : r.issues;
};

describe("instrument evidence schema", () => {
  it("accepts a complete GB / ISA evidence object", () => {
    expect(validateInstrumentEvidence(complete, ctx).ok).toBe(true);
  });
  it("requires GB / ISA only, case-insensitively", () => {
    expect(requiresCompleteEvidence("gb", "isa")).toBe(true);
    expect(requiresCompleteEvidence("GB", "SIPP")).toBe(false);
    expect(requiresCompleteEvidence("IE", "ISA")).toBe(false);
  });
  it("lists every missing item when no evidence is given", () => {
    for (const raw of [undefined, null, {}]) {
      const issues = issuesOf(raw, { broker: "Acme" });
      expect(issues.some((i) => i.startsWith("KID or factsheet"))).toBe(true);
      expect(issues.some((i) => i.startsWith("isaEligibility"))).toBe(true);
      expect(issues.some((i) => i.startsWith("listingEvidence"))).toBe(true);
      expect(issues.some((i) => i.startsWith("brokerSnapshot"))).toBe(true);
    }
  });
  it("refuses a missing KID hash, and a url or date without the rest of the document", () => {
    const { kidSha256: _h, ...noHash } = complete;
    expect(issuesOf(noHash).join()).toContain("kid: url, retrievedAt and sha256 must all be recorded together");
    expect(issuesOf({ ...complete, kidSha256: "abc" }).join()).toContain("kidSha256");
    expect(issuesOf({ ...complete, kidSha256: "g".repeat(64) }).join()).toContain("kidSha256");
  });
  it("accepts a factsheet instead of a KID", () => {
    const { kidUrl: _u, kidRetrievedAt: _d, kidSha256: _h, ...rest } = complete;
    const factsheet = { ...rest, factsheetUrl: "https://issuer.example/fs.pdf", factsheetRetrievedAt: "2026-10-01", factsheetSha256: HASH };
    expect(validateInstrumentEvidence(factsheet, ctx).ok).toBe(true);
    expect(issuesOf(rest).join()).toContain("KID or factsheet");
  });
  it("refuses a non-GBP listing for GB / ISA", () => {
    const usd = { ...complete, listingEvidence: { exchange: "LSE", ticker: "TEST", currency: "USD" } };
    expect(issuesOf(usd, { tradingLine: { exchange: "LSE", ticker: "TEST", currency: "USD" } }).join()).toContain("GBP trading line");
  });
  it("refuses listing evidence that disagrees with the stored trading line", () => {
    expect(issuesOf({ ...complete, listingEvidence: { exchange: "LSE", ticker: "OTHER", currency: "GBP" } }).join()).toContain("listingEvidence.ticker");
  });
  it("refuses non-https and credentialed URLs", () => {
    expect(issuesOf({ ...complete, kidUrl: "http://issuer.example/kid.pdf" }).join()).toContain("kidUrl");
    expect(issuesOf({ ...complete, kidUrl: "javascript:alert(1)" }).join()).toContain("kidUrl");
    expect(issuesOf({ ...complete, kidUrl: "https://user:pw@issuer.example/kid.pdf" }).join()).toContain("kidUrl");
    expect(issuesOf({ ...complete, isaEligibility: { ...complete.isaEligibility, sourceUrl: "ftp://x.example" } }).join()).toContain("isaEligibility.sourceUrl");
  });
  it("refuses future and impossible dates", () => {
    expect(issuesOf({ ...complete, kidRetrievedAt: "2026-10-14" }).join()).toContain("future");
    expect(issuesOf({ ...complete, kidRetrievedAt: "2026-02-30" }).join()).toContain("kidRetrievedAt");
    expect(issuesOf({ ...complete, isaEligibility: { ...complete.isaEligibility, checkedAt: "2027-01-01" } }).join()).toContain("isaEligibility.checkedAt");
  });
  it("refuses a missing ISA basis and an unknown basis", () => {
    const { isaEligibility: _i, ...rest } = complete;
    expect(issuesOf(rest).join()).toContain("isaEligibility");
    expect(issuesOf({ ...complete, isaEligibility: { ...complete.isaEligibility, basis: "TRUST_ME" } }).join()).toContain("isaEligibility.basis");
  });
  it("requires a broker snapshot that names the mapping's broker", () => {
    expect(issuesOf(complete, { broker: "Acme" }).join()).toContain("brokerSnapshot");
    const snap = { broker: "Other", source: "instrument list export", capturedAt: "2026-10-05" };
    expect(issuesOf({ ...complete, brokerSnapshot: snap }, { broker: "Acme" }).join()).toContain("does not match the mapping's broker");
    expect(validateInstrumentEvidence({ ...complete, brokerSnapshot: { ...snap, broker: "acme", fractionalSupported: true } }, { ...ctx, broker: "Acme" }).ok).toBe(true);
  });
  it("validates optional descriptors and rejects unknown keys", () => {
    expect(validateInstrumentEvidence({ ...complete, hedged: false, distributionPolicy: "ACCUMULATING", domicile: "ie", replicationMethod: "PHYSICAL_FULL", ter: "0.0007" }, ctx).ok).toBe(true);
    expect(issuesOf({ ...complete, ter: "0.07%" }).join()).toContain("ter");
    expect(issuesOf({ ...complete, ter: "0.5" }).join()).toContain("ter");
    expect(issuesOf({ ...complete, domicile: "IRL" }).join()).toContain("domicile");
    expect(issuesOf({ ...complete, verified: true }).length).toBeGreaterThan(0);
  });
  it("does not demand evidence for other countries or wrappers but still validates what is given", () => {
    expect(validateInstrumentEvidence({}, { ...ctx, wrapper: "GIA" }).ok).toBe(true);
    expect(issuesOf({ kidUrl: "http://x.example" }, { wrapper: "GIA" }).join()).toContain("kidUrl");
  });
  it("hashes canonical JSON independent of key order", () => {
    expect(canonicalEvidenceJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalEvidenceJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe("promotion schema carries evidence", () => {
  const base = {
    kind: "promote", mappingId: "11111111-1111-4111-8111-111111111111", isin: "US0378331005",
    checklist: { factsheetChecked: true, underlyingMatchesExposure: true, leverageAndDirectionMatch: true, listingCurrencyAndExchangeCorrect: true, wrapperAndCountryEligible: true },
    subject: { economicExposure: "BROAD_EQUITY", leverage: "1", direction: "LONG", country: "GB", wrapper: "ISA", tradingLineId: "22222222-2222-4222-8222-222222222222" },
    note: "Checked the issuer KID and factsheet on the issuer site."
  };
  it("keeps evidence optional at schema level (the server enforces completeness against the stored row)", () => {
    expect(promoteMappingSchema.safeParse(base).success).toBe(true);
    expect(promoteMappingSchema.safeParse({ ...base, evidence: complete }).success).toBe(true);
    expect(promoteMappingSchema.safeParse({ ...base, evidence: "x" }).success).toBe(false);
  });
  it("enforces evidence server-side, stores it and audits its hash", () => {
    const service = readFileSync("src/lib/instrument-promotion.ts", "utf8");
    expect(service).toContain("validateInstrumentEvidence(input.evidence");
    expect(service).toContain("throw new EvidenceRefused(");
    expect(service).toContain("evidence=$2::jsonb");
    expect(service).toContain("evidenceSha256");
    expect(service.indexOf("EvidenceRefused(")).toBeLessThan(service.indexOf("SET fidelity='EXACT'"));
    const route = readFileSync("src/app/api/admin/instruments/route.ts", "utf8");
    expect(route).toContain("error instanceof EvidenceRefused");
    const migration = readFileSync("db/migrations/0055_instrument_mapping_evidence.sql", "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'");
    expect(migration).toContain("pg_constraint");
  });
  it("shows the evidence inputs with visible labels and an accessible error region", () => {
    const ui = readFileSync("src/components/AdminInstrumentCandidates.tsx", "utf8");
    for (const label of ["KID URL", "KID SHA-256", "ISA eligibility basis", "Broker snapshot captured on"]) expect(ui).toContain(label);
    expect(ui).toContain("InlineMessage tone=\"error\"");
    expect(ui).toContain("does not prove it can be bought");
  });
});

describe("broker=null semantics (documented limitation, behaviour pinned)", () => {
  const mapping = {
    id: "m", economicExposure: "BROAD_EQUITY", leverage: "1", direction: "LONG", country: "GB", wrapper: "ISA",
    broker: null as string | null, preferredCurrency: "GBP", fidelity: "EXACT", effectiveFrom: "2026-01-01", effectiveTo: null,
    tradingLineId: "line", tradingLineCurrency: "GBP", tradingLineEffectiveFrom: "2026-01-01", tradingLineEffectiveTo: null
  };
  const request = { economicExposure: "BROAD_EQUITY", leverage: "1", direction: "LONG", country: "GB", wrapper: "ISA", preferredCurrency: "GBP", asOf: "2026-10-01" };
  it("a broker-null mapping still resolves for any broker and for manual mode (no broker)", () => {
    expect(resolveMapping([mapping], { ...request, broker: "Acme" })?.tradingLineId).toBe("line");
    expect(resolveMapping([mapping], { ...request, broker: null })?.tradingLineId).toBe("line");
  });
  it("a broker-specific mapping never resolves for another broker or for manual mode", () => {
    const acme = { ...mapping, broker: "Acme" };
    expect(resolveMapping([acme], { ...request, broker: "Other" })).toBeNull();
    expect(resolveMapping([acme], { ...request, broker: null })).toBeNull();
  });
  it("reports that a broker-agnostic mapping does not prove purchasability", () => {
    expect(purchasabilityEvidence({})).toBe("BROKER_AGNOSTIC_NOT_PROVEN");
    expect(purchasabilityEvidence(null)).toBe("BROKER_AGNOSTIC_NOT_PROVEN");
    expect(purchasabilityEvidence({ brokerSnapshot: { broker: "Acme", source: "list", capturedAt: "2026-10-05" } })).toBe("BROKER_SNAPSHOT_ON_FILE");
  });
});
