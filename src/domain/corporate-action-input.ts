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
    evidence: z.object({ sourceUrl: httpsUrl, retrievedAt: isoDate, note: noteText })
  }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid(), reason: noteText })
]);
export type CorporateActionRequest = z.infer<typeof corporateActionRequestSchema>;

/** A human-readable reason a parsed create request is still unacceptable, or null. `today` is YYYY-MM-DD (UTC). */
export function corporateActionIssue(request: CorporateActionRequest, today: string): string | null {
  if (request.action !== "create") return null;
  if (request.ratioTo === request.ratioFrom) return "A split ratio must change the number of units.";
  if (request.effectiveDate > today) return "The effective date cannot be in the future: confirm a split once it has taken effect.";
  if (request.effectiveDate < "2000-01-01") return "The effective date is too far in the past.";
  if (request.evidence.retrievedAt > today) return "The retrieval date cannot be in the future.";
  return null;
}
