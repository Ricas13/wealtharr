import { z } from "zod";

// Input rules for an administrator-confirmed stock split. The evidence is mandatory: a source an
// auditor can open, when it was retrieved, and a note saying what was checked.
export const MIN_CORPORATE_ACTION_NOTE_LENGTH = 20;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD date format.").refine((value) => {
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "That is not a real calendar date.");

const httpsUrl = z.string().trim().max(500).refine((value) => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "The source must be an https link.");

const ratioTerm = z.number().int("Ratios are whole numbers.").min(1, "Ratios are at least 1.").max(1000, "Ratios are limited to 1000.");
const noteText = z.string().trim()
  .min(MIN_CORPORATE_ACTION_NOTE_LENGTH, "The note must be at least " + MIN_CORPORATE_ACTION_NOTE_LENGTH + " characters: say what you checked.")
  .max(1000);

// A plain-object union so the route can switch on `action`; the cross-field rules are checked by
// `corporateActionIssue` after parsing.
export const corporateActionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    instrumentId: z.string().uuid(),
    ratioTo: ratioTerm,
    ratioFrom: ratioTerm,
    effectiveDate: isoDate,
    evidence: z.object({ sourceUrl: httpsUrl, retrievedAt: isoDate, note: noteText }),
    confirmPowerOfTenRisk: z.boolean().optional()
  }),
  // Reject a PENDING proposal or revoke a CONFIRMED action (either admin, with a reason).
  z.object({ action: z.literal("revoke"), id: z.string().uuid(), reason: noteText }),
  // A DIFFERENT admin turns a PENDING high-risk proposal into CONFIRMED.
  z.object({ action: z.literal("approve"), id: z.string().uuid() })
]);
export type CorporateActionRequest = z.infer<typeof corporateActionRequestSchema>;

/** A human-readable reason a parsed create request is still unacceptable, or null. `today` is YYYY-MM-DD (UTC). */
export function corporateActionIssue(request: CorporateActionRequest, today: string): string | null {
  if (request.action !== "create") return null;
  if (request.ratioTo === request.ratioFrom) return "A split ratio must change the number of units.";
  if (request.effectiveDate > today) return "The effective date cannot be in the future: confirm a split once it has taken effect.";
  if (request.effectiveDate < "2000-01-01") return "The effective date is too far in the past.";
  if (request.evidence.retrievedAt > today) return "The retrieval date cannot be in the future.";
  if (isPowerOfTenRatio(request.ratioTo, request.ratioFrom)) {
    if (request.confirmPowerOfTenRisk !== true) {
      return "This ratio is a power of ten, the shape of a pence/pounds or decimal error. Tick the confirmation after checking the currency and unit.";
    }
    if (request.evidence.note.length < MIN_POWER_OF_TEN_NOTE_LENGTH || !POWER_OF_TEN_NOTE_PATTERN.test(request.evidence.note)) {
      return "For a power-of-ten ratio the note must be at least " + MIN_POWER_OF_TEN_NOTE_LENGTH + " characters and say how you checked the currency or unit.";
    }
  }
  return null;
}

/** Greatest common divisor of two positive integers. */
function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) { const t = y; y = x % y; x = t; }
  return x;
}

/** A split ratio in lowest terms (4:2 -> 2:1). */
export function reduceRatio(to: number, from: number): { to: number; from: number } {
  const divisor = gcd(to, from) || 1;
  return { to: to / divisor, from: from / divisor };
}

/**
 * True when the ratio's magnitude max/min is within 15% of 10, 100 or 1000 (in [8.5,11.5], [85,115]
 * or [850,1150]), in either direction: the shape of a pence/pounds or dropped-decimal error, including
 * near misses such as 2:21 (x10.5) that the exact reduced form 10:1 would not catch.
 */
export function isPowerOfTenRatio(to: number, from: number): boolean {
  const larger = Math.max(to, from);
  const smaller = Math.min(to, from);
  if (!(smaller >= 1)) return false;
  // Integer arithmetic: 8.5 = 17/2 and 11.5 = 23/2; 85 and 115; 850 and 1150.
  if (2 * larger >= 17 * smaller && 2 * larger <= 23 * smaller) return true;
  if (larger >= 85 * smaller && larger <= 115 * smaller) return true;
  return larger >= 850 * smaller && larger <= 1150 * smaller;
}

export const MIN_POWER_OF_TEN_NOTE_LENGTH = 40;
/** The note must show the unit/currency check was made (pence versus pounds is the usual cause of a x10/x100 quote). */
export const POWER_OF_TEN_NOTE_PATTERN = /currenc|pence|pound|gbx|gbp|\bunits?\b|decimal/i;

/** Currencies quoted in minor units, where a x100 provider error is most likely. */
export const MINOR_UNIT_CURRENCIES = ["GBX", "GBp", "ZAc", "ZAC", "ILA", "ILa"];

/** A PENDING proposal lapses to REVOKED after this many days without a second admin's approval. */
export const PENDING_ACTION_DAYS = 7;

/**
 * Ratios whose reduced form is a power of ten, or has a term above 50 in either direction, are the
 * shape of a pence/pounds, decimal or stub-price error. They are proposed by one admin (PENDING) and
 * only a DIFFERENT admin can confirm them. Other ratios are confirmed by their creator.
 */
export function requiresSecondAdmin(to: number, from: number): boolean {
  const reduced = reduceRatio(to, from);
  if (reduced.to > 50 || reduced.from > 50) return true;
  const larger = Math.max(reduced.to, reduced.from);
  const smaller = Math.min(reduced.to, reduced.from);
  // Numeric closeness, not the reduced form: 2:21 (x10.5) is a dropped-decimal error in a split's
  // clothing. A magnitude of 5 or more (either direction) needs a second admin; integer arithmetic.
  return larger >= 5 * smaller;
}
