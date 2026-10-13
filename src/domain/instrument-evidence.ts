import Decimal from "decimal.js";
import { z } from "zod";

/**
 * Evidence recorded with a verified instrument mapping (regional_instrument_mappings.evidence).
 *
 * Nothing in this module checks the evidence against the real world: it validates that an operator
 * RECORDED the documents they relied on (where, when, content hash) in a well-formed way. "Verified"
 * on the platform means exactly that: operator-verified on a date against the recorded documents for
 * one country / wrapper / broker. It is never a guarantee of purchasability, tax treatment or
 * suitability. See docs/uk-instrument-selection-methodology.md.
 */

export const ISA_ELIGIBILITY_BASES = [
  "LISTED_ON_RECOGNISED_STOCK_EXCHANGE",
  "UCITS_OR_AUTHORISED_FUND",
  "OTHER_DOCUMENTED"
] as const;
export const DISTRIBUTION_POLICIES = ["ACCUMULATING", "DISTRIBUTING"] as const;
export const REPLICATION_METHODS = ["PHYSICAL_FULL", "PHYSICAL_SAMPLED", "SYNTHETIC"] as const;

export type InstrumentEvidence = {
  kidUrl?: string;
  kidRetrievedAt?: string;
  kidSha256?: string;
  factsheetUrl?: string;
  factsheetRetrievedAt?: string;
  factsheetSha256?: string;
  isaEligibility?: { basis: (typeof ISA_ELIGIBILITY_BASES)[number]; sourceUrl: string; checkedAt: string };
  listingEvidence?: { exchange: string; ticker: string; sedol?: string; currency: string };
  brokerSnapshot?: { broker: string; source: string; capturedAt: string; fractionalSupported?: boolean };
  hedged?: boolean;
  distributionPolicy?: (typeof DISTRIBUTION_POLICIES)[number];
  domicile?: string;
  replicationMethod?: (typeof REPLICATION_METHODS)[number];
  /** Total expense ratio as a decimal FRACTION string, e.g. "0.0007" is 0.07% a year. */
  ter?: string;
};

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0 && !url.username && !url.password;
  } catch { return false; }
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);

const httpsUrl = z.string().trim().min(1).max(2048).refine(isHttpsUrl, "must be an https:// URL without credentials");
const sha256 = z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, "must be a 64-character hexadecimal SHA-256");
const text = (max: number) => z.string().trim().min(1).max(max);
const ter = z.string().trim().refine((v) => {
  if (!/^\d+(\.\d+)?$/.test(v)) return false;
  try { return new Decimal(v).lte("0.1"); } catch { return false; }
}, "must be a non-negative decimal fraction of at most 0.1 (0.0007 means 0.07%)");

/** Builds the strict evidence shape; `today` (YYYY-MM-DD) bounds every retrieval/check date. */
export function makeEvidenceSchema(today: string = todayUtc()) {
  const pastDate = z.string().trim().refine(isIsoDate, "must be a real date written YYYY-MM-DD")
    .refine((v) => !isIsoDate(v) || v <= today, "must not be in the future");
  return z.object({
    kidUrl: httpsUrl.optional(),
    kidRetrievedAt: pastDate.optional(),
    kidSha256: sha256.optional(),
    factsheetUrl: httpsUrl.optional(),
    factsheetRetrievedAt: pastDate.optional(),
    factsheetSha256: sha256.optional(),
    isaEligibility: z.object({
      basis: z.enum(ISA_ELIGIBILITY_BASES),
      sourceUrl: httpsUrl,
      checkedAt: pastDate
    }).strict().optional(),
    listingEvidence: z.object({
      exchange: text(32),
      ticker: text(32),
      sedol: z.string().trim().toUpperCase().regex(/^[0-9BCDFGHJKLMNPQRSTVWXYZ]{7}$/, "must be a 7-character SEDOL").optional(),
      currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "must be a 3-letter ISO 4217 code")
    }).strict().optional(),
    brokerSnapshot: z.object({
      broker: text(64),
      source: text(300),
      capturedAt: pastDate,
      fractionalSupported: z.boolean().optional()
    }).strict().optional(),
    hedged: z.boolean().optional(),
    distributionPolicy: z.enum(DISTRIBUTION_POLICIES).optional(),
    domicile: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "must be a 2-letter ISO 3166 country code").optional(),
    replicationMethod: z.enum(REPLICATION_METHODS).optional(),
    ter: ter.optional()
  }).strict();
}

/** GB / ISA mappings must carry a complete evidence object before they can become EXACT. */
export function requiresCompleteEvidence(country: string, wrapper: string): boolean {
  return country.trim().toUpperCase() === "GB" && wrapper.trim().toUpperCase() === "ISA";
}

export type EvidenceContext = {
  country: string;
  wrapper: string;
  /** The mapping's broker (null when broker-agnostic). */
  broker: string | null;
  today?: string;
  /** The stored trading line; when given, listing evidence must agree with it. */
  tradingLine?: { exchange: string; ticker: string; currency: string };
};

export type EvidenceResult =
  | { ok: true; evidence: InstrumentEvidence }
  | { ok: false; issues: string[] };

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Validates a raw evidence object. Pure and fail-closed: every problem is returned as a readable
 * line so the operator can fix all of them in one pass. `raw` undefined or {} counts as "no evidence".
 */
export function validateInstrumentEvidence(raw: unknown, ctx: EvidenceContext): EvidenceResult {
  const required = requiresCompleteEvidence(ctx.country, ctx.wrapper);
  const issues: string[] = [];
  const empty = raw == null || (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw as object).length === 0);
  if (empty) {
    if (!required) return { ok: true, evidence: {} };
    return { ok: false, issues: requiredItems(ctx) };
  }
  const parsed = makeEvidenceSchema(ctx.today ?? todayUtc()).safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length ? issue.path.join(".") : "evidence";
      issues.push(path + ": " + issue.message);
    }
    return { ok: false, issues };
  }
  const evidence = parsed.data as InstrumentEvidence;

  // A document is only usable when its URL, retrieval date and content hash are all recorded.
  for (const doc of ["kid", "factsheet"] as const) {
    const present = [evidence[`${doc}Url`], evidence[`${doc}RetrievedAt`], evidence[`${doc}Sha256`]].filter((v) => v !== undefined).length;
    if (present > 0 && present < 3) issues.push(doc + ": url, retrievedAt and sha256 must all be recorded together");
  }
  if (evidence.listingEvidence && ctx.tradingLine) {
    const l = evidence.listingEvidence, t = ctx.tradingLine;
    if (!sameText(l.exchange, t.exchange)) issues.push("listingEvidence.exchange: does not match the trading line (" + t.exchange + ")");
    if (!sameText(l.ticker, t.ticker)) issues.push("listingEvidence.ticker: does not match the trading line (" + t.ticker + ")");
    if (!sameText(l.currency, t.currency)) issues.push("listingEvidence.currency: does not match the trading line (" + t.currency + ")");
  }
  if (evidence.brokerSnapshot && ctx.broker && !sameText(evidence.brokerSnapshot.broker, ctx.broker)) {
    issues.push("brokerSnapshot.broker: does not match the mapping's broker (" + ctx.broker + ")");
  }
  if (required) issues.push(...requiredMissing(evidence, ctx));
  return issues.length ? { ok: false, issues } : { ok: true, evidence };
}

function requiredItems(ctx: EvidenceContext): string[] {
  return requiredMissing({}, ctx);
}

function requiredMissing(e: InstrumentEvidence, ctx: EvidenceContext): string[] {
  const missing: string[] = [];
  const kid = e.kidUrl && e.kidRetrievedAt && e.kidSha256;
  const fact = e.factsheetUrl && e.factsheetRetrievedAt && e.factsheetSha256;
  if (!kid && !fact) missing.push("KID or factsheet: URL, retrieval date and SHA-256 are required");
  if (!e.isaEligibility) missing.push("isaEligibility: basis, source URL and date checked are required");
  if (!e.listingEvidence) missing.push("listingEvidence: exchange, ticker and currency are required");
  else if (e.listingEvidence.currency !== "GBP") missing.push("listingEvidence.currency: a GB / ISA mapping must be a GBP trading line (the app has no FX)");
  if (ctx.broker && !e.brokerSnapshot) missing.push("brokerSnapshot: a dated snapshot from " + ctx.broker + " is required because the mapping names that broker");
  return missing;
}

/** Deterministic JSON (sorted keys, no whitespace) so the same evidence always hashes the same. */
export function canonicalEvidenceJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export type PurchasabilityEvidence = "BROKER_SNAPSHOT_ON_FILE" | "BROKER_AGNOSTIC_NOT_PROVEN";

/**
 * What a mapping proves about purchasability. A mapping with broker=null still resolves for every
 * broker (existing behaviour, deliberately unchanged) but proves nothing about any broker unless a
 * dated broker snapshot is recorded. Even then it is evidence of listing on that date, not a guarantee.
 */
export function purchasabilityEvidence(evidence: InstrumentEvidence | null | undefined): PurchasabilityEvidence {
  return evidence?.brokerSnapshot ? "BROKER_SNAPSHOT_ON_FILE" : "BROKER_AGNOSTIC_NOT_PROVEN";
}
