import Decimal from "decimal.js";
import { z } from "zod";
import { isValidIsin } from "./instrument-import";
import { isRegisteredExposure } from "./strategy/exposures";

/**
 * Promoting an import CANDIDATE to a verified EXACT mapping is a human decision. Nothing here (or
 * anywhere) verifies a mapping automatically: every checklist item must be explicitly confirmed,
 * with a written note, by an MFA-protected administrator, and every refusal fails closed.
 */
export const MIN_VERIFICATION_NOTE_LENGTH = 20;
export const MAX_VERIFICATION_NOTE_LENGTH = 2000;

export const CHECKLIST_ITEMS = [
  { key: "factsheetChecked", label: "Issuer factsheet / KID checked against this ISIN" },
  { key: "underlyingMatchesExposure", label: "Index / underlying matches the economic exposure" },
  { key: "leverageAndDirectionMatch", label: "Leverage and direction match the mapping" },
  { key: "listingCurrencyAndExchangeCorrect", label: "Listing currency and exchange are correct" },
  { key: "wrapperAndCountryEligible", label: "Wrapper and country eligibility confirmed" }
] as const;

const confirmed = z.literal(true, { error: "Every checklist item must be confirmed." });
export const promotionChecklistSchema = z.object({
  factsheetChecked: confirmed,
  underlyingMatchesExposure: confirmed,
  leverageAndDirectionMatch: confirmed,
  listingCurrencyAndExchangeCorrect: confirmed,
  wrapperAndCountryEligible: confirmed
}).strict();

/** The facts the reviewer verified. The server re-reads the row and refuses if any of it changed. */
export const promotionSubjectSchema = z.object({
  economicExposure: z.string().min(1),
  leverage: z.string().min(1),
  direction: z.enum(["LONG", "SHORT"]),
  country: z.string().length(2),
  wrapper: z.string().min(1),
  tradingLineId: z.string().uuid()
}).strict();

const note = z.string().trim().min(MIN_VERIFICATION_NOTE_LENGTH, "Write a verification note of at least " + MIN_VERIFICATION_NOTE_LENGTH + " characters.").max(MAX_VERIFICATION_NOTE_LENGTH);

export const promoteMappingSchema = z.object({
  kind: z.literal("promote"),
  mappingId: z.string().uuid(),
  isin: z.string().trim().toUpperCase().refine(isValidIsin, "ISIN is not valid (ISO 6166 format and check digit)."),
  providerSymbol: z.string().trim().min(1).max(64).nullable().optional(),
  checklist: promotionChecklistSchema,
  subject: promotionSubjectSchema,
  note
});

export const rejectMappingSchema = z.object({
  kind: z.literal("reject"),
  mappingId: z.string().uuid(),
  note
});

export type PromoteMappingInput = z.infer<typeof promoteMappingSchema>;
export type RejectMappingInput = z.infer<typeof rejectMappingSchema>;

export type PromotionRefusal =
  | "NOT_FOUND"
  | "NOT_CANDIDATE"
  | "SUBJECT_CHANGED"
  | "UNREGISTERED_EXPOSURE"
  | "INSTRUMENT_MISMATCH"
  | "ISIN_MISMATCH"
  | "ISIN_IN_USE"
  | "AMBIGUOUS_MAPPING"
  | "DUPLICATE_MAPPING"
  | "PROVIDER_SYMBOL_CONFLICT"
  | "INSTRUMENT_IN_USE"
  | "TRADING_LINE_IN_USE";

export const PROMOTION_REFUSALS: Record<PromotionRefusal, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: "That mapping no longer exists." },
  NOT_CANDIDATE: { status: 409, message: "Only a mapping that is still a candidate can be verified or rejected." },
  SUBJECT_CHANGED: { status: 409, message: "The mapping no longer matches what you verified. Reload and review it again." },
  UNREGISTERED_EXPOSURE: { status: 409, message: "The economic exposure is not in the exposure registry." },
  INSTRUMENT_MISMATCH: { status: 409, message: "The trading line's instrument has a different exposure, leverage or direction than the mapping." },
  ISIN_MISMATCH: { status: 409, message: "The ISIN differs from the one stored on the instrument." },
  ISIN_IN_USE: { status: 409, message: "That ISIN already belongs to a different instrument." },
  AMBIGUOUS_MAPPING: { status: 409, message: "Another enabled verified mapping already covers this exposure, country, wrapper, broker and currency with a different trading line. Resolve it first; nothing was changed." },
  DUPLICATE_MAPPING: { status: 409, message: "A verified mapping for this trading line already exists." },
  PROVIDER_SYMBOL_CONFLICT: { status: 409, message: "The trading line already has a different provider symbol and other verified mappings use it. Nothing was changed." },
  INSTRUMENT_IN_USE: { status: 409, message: "This instrument sits behind an enabled verified mapping, so its ISIN, exposure, leverage or direction cannot be changed. Disable the mapping first." },
  TRADING_LINE_IN_USE: { status: 409, message: "This trading line sits behind an enabled verified mapping, so it cannot be repointed to another instrument or currency. Disable the mapping first." }
};

export class PromotionRefused extends Error {
  constructor(readonly code: PromotionRefusal) { super(code); }
}

export type MappingRow = {
  economicExposure: string;
  leverage: string;
  direction: string;
  country: string;
  wrapper: string;
  tradingLineId: string;
};

const sameLeverage = (a: string, b: string) => {
  try { const x = new Decimal(a), y = new Decimal(b); return x.isFinite() && y.isFinite() && x.gt(0) && x.eq(y); } catch { return false; }
};

/** True only when every declared subject field equals the stored row (leverage compared numerically). */
export function subjectMatchesMapping(subject: z.infer<typeof promotionSubjectSchema>, row: MappingRow): boolean {
  return subject.economicExposure === row.economicExposure
    && sameLeverage(subject.leverage, row.leverage)
    && subject.direction === row.direction
    && subject.country === row.country
    && subject.wrapper === row.wrapper
    && subject.tradingLineId === row.tradingLineId;
}

export function exposureIsRegistered(exposure: string) {
  return isRegisteredExposure(exposure);
}

export type PeerMapping = {
  id: string;
  economicExposure: string;
  leverage: string;
  direction: string;
  country: string;
  wrapper: string;
  broker: string | null;
  preferredCurrency: string | null;
  tradingLineId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const norm = (v: string | null) => (v == null ? "" : v.toLowerCase());
const overlaps = (a: PeerMapping, b: PeerMapping) =>
  (b.effectiveTo == null || a.effectiveFrom <= b.effectiveTo) && (a.effectiveTo == null || b.effectiveFrom <= a.effectiveTo);

/**
 * Classifies a candidate against the already enabled EXACT mappings. A peer with the same lookup key
 * (exposure, leverage, direction, country, wrapper, broker, currency) whose validity overlaps is a
 * conflict: a different trading line would be ambiguous or silently override it, so promotion is
 * refused (stricter than the resolver, which only returns null for exactly equal ranks).
 */
export function classifyPromotion(candidate: PeerMapping, peers: readonly PeerMapping[]): "OK" | "AMBIGUOUS_MAPPING" | "DUPLICATE_MAPPING" {
  const sameKey = peers.filter((p) =>
    p.id !== candidate.id
    && p.economicExposure === candidate.economicExposure
    && sameLeverage(p.leverage, candidate.leverage)
    && p.direction === candidate.direction
    && p.country === candidate.country
    && p.wrapper === candidate.wrapper
    && norm(p.broker) === norm(candidate.broker)
    && norm(p.preferredCurrency) === norm(candidate.preferredCurrency)
    && overlaps(p, candidate));
  if (sameKey.some((p) => p.tradingLineId !== candidate.tradingLineId)) return "AMBIGUOUS_MAPPING";
  if (sameKey.length) return "DUPLICATE_MAPPING";
  return "OK";
}
