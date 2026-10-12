import Decimal from "decimal.js";
import type { EngineContext, ExplanationRow, ProposedAction } from "./types";
import { calendarQuarterEndAt, calendarQuarterIndexAfter, latestCalendarQuarterEnd, type CalendarQuarterEnd } from "../schedule";

/**
 * 9Sig v1.1: Jason Kelly's quarterly signal method, as documented in docs/strategy-specs/9sig.md.
 *
 * Selected only by `methodRevision: KELLY_SIGNAL_REVISION` in a strategy version's config. Version 1.0
 * (no `methodRevision`) keeps the legacy VALUE_TARGET calculation in value-target.ts unchanged.
 *
 * Rules implemented (spec card ids; status on the card):
 * - R2 (Confirmed): the line grows 9% per quarter, compounding.
 * - R3 (Confirmed): one review per calendar quarter, at the quarter-end review point; no intra-quarter
 *   trades. The cutoff (16:00 America/New_York) is a Wealtharr choice: which price the author uses
 *   is R13, Unverified (Q4).
 * - R4 (Single source, author): the line is anchored on the ACTUAL post-order balance of the previous
 *   review, not on the previous target, so an under-funded buy lowers the next line (Q9).
 * - R5 (Confirmed): add half of the quarter's new cash to the line.
 * - R6 (Confirmed): new cash = contributions plus distributions (DIVIDEND, DISTRIBUTION, INTEREST).
 * - R7 (Single source, author): each quarter's new cash is counted once, never carried forward.
 * - R8 (Confirmed): sell any surplus, buy any shortfall. There is NO tolerance band. Amounts are
 *   rounded to whole cents only because money is held to 2 decimal places.
 * - R9 (Single source, author; S4, 2018, quoting the user guide, POSSIBLY OUTDATED, Q2b): a quarter's
 *   buy may use at most 90% of the safe sleeve's balance at the start of the review. The cap is sized
 *   once per review (not per fill, not geometrically).
 * - R10 (Confirmed): when the safe sleeve cannot cover the buy, buy what it can and close the review.
 *   Never ask for outside cash.
 * - R17 (Single source, author): no floor on the stock weight.
 *
 * Deliberately NOT implemented (Unverified or conflicting on the card, see Q2-Q7):
 * - R12 30 Down (skip-sell count conflicts 4/2/1; trigger stated only by a reader and a third party).
 * - R14 spike reset (single 2018 source; excluded by the owner brief until the guide is confirmed).
 * - R15 reset when bonds grow large (Unverified for 9Sig).
 * - R16 withdrawals: withdrawals only reduce cash; they never change the line.
 * - R11 base reset. The 60% initial allocation is the inherited v1.0 Wealtharr convention; the card
 *   marks 60/40 "Unverified as current" (Q2).
 * - R1 bond fund: the safe sleeve is the strategy's cash balance. Holding a bond fund is Q1; a bond
 *   holding still returns "A holding needs classification".
 *
 * Wealtharr conventions the card is silent on (documented on the card):
 * - The first (initial) review counts as the review of the calendar quarter in progress, so the first
 *   9% step is applied at the end of the first full calendar quarter.
 * - A v1.0 state migrated to v1.1: its last confirmed review counts as the review of the quarter in
 *   which it happened, and its committed v1.0 target is the anchor (no post-order balance was stored).
 * - Missed quarters compound: anchor x 1.09^n for n elapsed calendar quarters.
 * - The order is sized at the first calculation the user executes; partial fills continue the same
 *   frozen order. New cash recorded after the quarter-end cutoff belongs to the next quarter.
 */
export const KELLY_SIGNAL_REVISION = "KELLY_SIGNAL_2026_10";
/** Ledger event types counted as the quarter's new cash (R6). Fixed constants, never user input. */
export const KELLY_NEW_CASH_EVENT_TYPES = ["CONTRIBUTION", "DIVIDEND", "DISTRIBUTION", "INTEREST"] as const;
/** State key of an open v1.1 review; carried across fills by postActionReviewState. */
export const KELLY_REVIEW_STATE_KEY = "kellySignalReview";
/** Injected by the action service from an active target override. Never persisted. */
export const KELLY_ANCHOR_OVERRIDE_KEY = "kellyAnchorOverride";
/** On a closing HOLD: the target override that executeAction deactivates in the same transaction. */
export const KELLY_CONSUMED_OVERRIDE_KEY = "consumedTargetOverrideId";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isKellySignalConfig(config: Record<string, unknown> | null | undefined) {
  return config?.methodRevision === KELLY_SIGNAL_REVISION;
}

/** SQL fragment listing the new-cash event types (built from the constant list above only). */
export function kellyNewCashEventTypesSql() {
  return KELLY_NEW_CASH_EVENT_TYPES.map((type) => "'" + type + "'").join(",");
}

type KellyCalendar = { timeZone: string; cutoffLocal: string; holidays: string[]; convention: "PREVIOUS" | "NEXT" };

export function kellyCalendar(config: Record<string, unknown>): KellyCalendar {
  const timeZone = String(config.reviewTimezone ?? "").trim();
  if (!timeZone) throw new Error("INVALID_VALUE_TARGET_CONFIG:reviewTimezone");
  new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  const holidays = Array.isArray(config.marketHolidays) ? config.marketHolidays.filter((v): v is string => typeof v === "string") : [];
  return {
    timeZone,
    cutoffLocal: String(config.reviewCutoffLocal ?? "16:00"),
    holidays,
    convention: config.businessDayConvention === "NEXT" ? "NEXT" : "PREVIOUS"
  };
}

export function validateKellySignalConfig(config: Record<string, unknown>) {
  if (config.reviewSchedule !== "CALENDAR_QUARTER_END") throw new Error("INVALID_VALUE_TARGET_CONFIG:reviewSchedule");
  if (String(config.reviewFrequency ?? "QUARTERLY") !== "QUARTERLY") throw new Error("INVALID_VALUE_TARGET_CONFIG:reviewFrequency");
  try { kellyCalendar(config); } catch { throw new Error("INVALID_VALUE_TARGET_CONFIG:reviewTimezone"); }
  // Every rule parameter must be stated explicitly in a v1.1 version: no defaults.
  const bounded: Array<[string, string, string]> = [
    ["initialTargetRatio", "0", "1"], ["contributionTargetRatio", "0", "1"], ["reviewBuyCapRatio", "0", "1"], ["targetRate", "-1", "10"]
  ];
  for (const [key, min, max] of bounded) {
    const raw = config[key];
    let value: Decimal;
    try { value = new Decimal(typeof raw === "string" ? raw : "NaN"); } catch { value = new Decimal(NaN); }
    if (!value.isFinite() || value.lte(min) || value.gt(max)) throw new Error("INVALID_VALUE_TARGET_CONFIG:" + key);
  }
}

type OpenReview = {
  periodIndex: number;
  periodEnd: string;
  newCashFrom: string;
  side: "BUY" | "SELL";
  orderAmount: string;
  signalLine: string;
  openedAt: string;
  initial: boolean;
  steps: number;
  anchorOverrideId?: string;
};

function isoInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseOpenReview(raw: unknown): OpenReview | null | "INVALID" {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "INVALID";
  const r = raw as Record<string, unknown>;
  const decimal = (v: unknown) => { try { return typeof v === "string" ? new Decimal(v) : null; } catch { return null; } };
  const amount = decimal(r.orderAmount);
  const line = decimal(r.signalLine);
  if (!Number.isSafeInteger(r.periodIndex) || typeof r.periodEnd !== "string" || !isoInstant(r.newCashFrom) ||
      (r.side !== "BUY" && r.side !== "SELL") || !amount || !amount.isFinite() || amount.lte(0) ||
      !line || !line.isFinite() || line.lte(0) || !isoInstant(r.openedAt) || typeof r.initial !== "boolean" ||
      !Number.isSafeInteger(r.steps) || (r.steps as number) < 0 ||
      (r.anchorOverrideId !== undefined && (typeof r.anchorOverrideId !== "string" || !UUID_RE.test(r.anchorOverrideId))))
    return "INVALID";
  return r as unknown as OpenReview;
}

/**
 * The instants the action service needs to read the ledger for this revision.
 * newCash window: (newCashFrom, newCashTo], by when each row was RECORDED (created_at), so a
 * backdated entry is counted exactly once, in the quarter in which it was entered.
 * fillsFrom: BUY/SELL rows recorded after the open review started (null when no review is open).
 * Returns null when the saved state cannot be read; the engine then fails closed.
 */
export function kellyLedgerWindow(input: { state: Record<string, unknown>; config: Record<string, unknown>; now: Date; startedAt: Date }) {
  try {
    const calendar = kellyCalendar(input.config);
    const newCashTo = latestCalendarQuarterEnd({ now: input.now, ...calendar }).cutoff;
    const review = parseOpenReview(input.state[KELLY_REVIEW_STATE_KEY]);
    if (review === "INVALID") return null;
    const fillsFrom = review ? isoInstant(review.openedAt) : null;
    const savedFrom = input.state.newCashFrom ?? input.state.lastReviewAt;
    const newCashFrom = savedFrom == null ? input.startedAt : isoInstant(savedFrom);
    if (!newCashFrom || !Number.isFinite(input.startedAt.getTime())) return null;
    return { newCashFrom, newCashTo, fillsFrom };
  } catch {
    return null;
  }
}

function money(v: Decimal) { return v.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toFixed(2); }
function ratio(config: Record<string, unknown>, key: string) { return new Decimal(String(config[key])); }

function stripTransient(state: Record<string, unknown>) {
  const base = { ...state };
  delete base[KELLY_ANCHOR_OVERRIDE_KEY];
  delete base[KELLY_CONSUMED_OVERRIDE_KEY];
  return base;
}

function dataRequired(ctx: EngineContext, base: Record<string, unknown>, title: string, instruction: string, explanation: ExplanationRow[] = []): ProposedAction {
  return { actionType: "DATA_REQUIRED", title, instruction, explanation, nextState: base, confidence: "LOW", dueAt: ctx.now };
}

/** The last closed review period of a non-initial state (v1.1 or migrated v1.0), or null if unreadable. */
function lastClosedPeriodIndex(state: Record<string, unknown>, calendar: KellyCalendar): number | null {
  if (state.signalPeriodIndex !== undefined)
    return Number.isSafeInteger(state.signalPeriodIndex) && (state.signalPeriodIndex as number) >= 0 ? state.signalPeriodIndex as number : null;
  // Migrated v1.0 state: its last confirmed review counts for the quarter in which it happened.
  const last = isoInstant(state.lastReviewAt);
  if (!last) return null;
  try { return calendarQuarterIndexAfter(last, calendar); } catch { return null; }
}

export function calculateKellySignal(ctx: EngineContext): ProposedAction {
  const base = stripTransient(ctx.state);
  if (ctx.dataHealth.status !== "CURRENT") {
    return { actionType: "DATA_REQUIRED", title: "Data needs attention", instruction: ctx.dataHealth.message ?? "Current source data is not reliable enough to calculate a financial action.", explanation: [{ label: "Data status", value: ctx.dataHealth.status, kind: "text" }], nextState: base, confidence: "LOW", dueAt: ctx.nextReviewAt };
  }
  try { validateKellySignalConfig(ctx.config); } catch {
    return dataRequired(ctx, base, "Strategy rules need attention", "This strategy version's rule configuration is invalid, so no action can be calculated.");
  }
  let calendar: KellyCalendar;
  let period: CalendarQuarterEnd;
  try {
    calendar = kellyCalendar(ctx.config);
    period = latestCalendarQuarterEnd({ now: ctx.now, ...calendar });
  } catch {
    return dataRequired(ctx, base, "Review calendar needs attention", "The strategy's quarter-end review calendar could not be evaluated.");
  }
  const review = parseOpenReview(ctx.state[KELLY_REVIEW_STATE_KEY]);
  if (review === "INVALID") return dataRequired(ctx, base, "Saved review needs attention", "The open quarterly review is unreadable. Reconcile the strategy before trading.");
  const isInitial = review ? review.initial : ctx.state.targetValue == null && ctx.state.anchorValue == null;
  let lastIndex: number | null = null;
  if (!review && !isInitial) {
    lastIndex = lastClosedPeriodIndex(ctx.state, calendar);
    if (lastIndex == null) return dataRequired(ctx, base, "Saved review period needs attention", "The last completed quarterly review cannot be identified. Reconcile the strategy before trading.");
  }
  // Due only at a new calendar quarter (or for the first review, or to finish an open review).
  // A forced recalculation (resume, version migration, imported trade) inside a quarter whose review
  // is already closed is NOT a new period: it neither grows the line nor trades mid-quarter.
  const due = review ? true : isInitial ? ctx.reviewDue : period.index > (lastIndex as number);
  if (!due) {
    const next = isInitial ? (ctx.nextReviewAt ?? null) : calendarQuarterEndAt((lastIndex as number) + 1, calendar).cutoff;
    return { actionType: "NO_ACTION", title: "Everything is on track", instruction: "No strategy review is due until the next calendar quarter end.", explanation: next ? [{ label: "Next review", value: next.toISOString(), kind: "text" }] : [], nextState: base, confidence: "HIGH", dueAt: next };
  }

  const exposureKey = String(ctx.config.targetExposure ?? "");
  const leverage = String(ctx.config.targetLeverage ?? "").trim() || undefined;
  const unmanaged = ctx.exposures.filter((x) => x.economicExposure !== exposureKey && !x.value.eq(0));
  if (unmanaged.length) {
    return { actionType: "DATA_REQUIRED", title: "A holding needs classification", instruction: "This strategy contains a holding outside its managed exposure. Move it out of this strategy or reconcile the account before we calculate a trade.", explanation: unmanaged.map((item) => ({ label: "Outside strategy", value: item.economicExposure, kind: "text" as const })), nextState: base, confidence: "LOW", dueAt: ctx.now };
  }
  const ledger = ctx.signalLedger;
  if (!ledger || ![ledger.newCash, ledger.filledBuy, ledger.filledSell].every((v) => v.isFinite() && v.gte(0)))
    return dataRequired(ctx, base, "Ledger totals need attention", "The quarter's new cash and recorded fills could not be read. Reconcile the strategy before trading.");
  if (!ctx.cash.isFinite()) return dataRequired(ctx, base, "Cash balance needs attention", "The recorded cash balance is not valid.");
  const current = ctx.exposures.filter((x) => x.economicExposure === exposureKey).reduce((sum, x) => sum.plus(x.value), new Decimal(0));

  const closeState = (r: Pick<OpenReview, "periodIndex" | "periodEnd" | "newCashFrom" | "signalLine" | "anchorOverrideId">) => {
    const next: Record<string, unknown> = { ...base };
    delete next[KELLY_REVIEW_STATE_KEY];
    delete next.reviewTargetValue;
    delete next.reviewContributionsSnapshot;
    next.targetValue = r.signalLine;
    // R4: the next quarter is anchored on the actual balance after this review's order.
    next.anchorValue = current.toString();
    next.signalPeriodIndex = r.periodIndex;
    next.signalPeriodEnd = r.periodEnd;
    next.newCashFrom = r.newCashFrom;
    next.lastCalculatedAt = ctx.now.toISOString();
    if (r.anchorOverrideId) next[KELLY_CONSUMED_OVERRIDE_KEY] = r.anchorOverrideId;
    return next;
  };
  const hold = (r: Parameters<typeof closeState>[0], instruction: string, explanation: ExplanationRow[]): ProposedAction => ({
    actionType: "HOLD", title: "No further trade this quarter", instruction, explanation, nextState: closeState(r), confidence: "HIGH", dueAt: ctx.now
  });
  const trade = (r: OpenReview, amount: Decimal, explanation: ExplanationRow[], fallbackText: string): ProposedAction => {
    const verb = r.side === "BUY" ? "add" : "reduce";
    return {
      actionType: r.side,
      title: (r.side === "BUY" ? "Buy " : "Sell ") + money(amount) + " of the target exposure",
      instruction: "Under the strategy rules you selected, " + verb + " " + exposureKey + " exposure by " + money(amount) + " " + ctx.baseCurrency + ".",
      amount, currency: ctx.baseCurrency, economicExposure: exposureKey, leverage, explanation,
      nextState: { ...base, targetValue: r.signalLine, lastCalculatedAt: ctx.now.toISOString(), [KELLY_REVIEW_STATE_KEY]: r },
      confidence: "HIGH", dueAt: ctx.now,
      unexecutableFallback: hold(r, fallbackText, explanation)
    };
  };
  const fallbackText = "The rest of this quarter's order cannot be placed under your trade preferences, so this quarter's review closes without it.";

  if (review) {
    const filled = review.side === "BUY" ? ledger.filledBuy : ledger.filledSell;
    let remaining = new Decimal(review.orderAmount).minus(filled);
    if (review.side === "BUY") remaining = Decimal.min(remaining, ctx.cash);
    remaining = remaining.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const explanation: ExplanationRow[] = [
      { label: "Current strategy value", value: money(current), kind: "money" },
      { label: "Signal line", value: money(new Decimal(review.signalLine)), kind: "money" },
      { label: "This quarter's order", value: money(new Decimal(review.orderAmount)), kind: "money" },
      { label: "Already filled", value: money(filled), kind: "money" }
    ];
    if (remaining.lte(0)) {
      const cashLimited = review.side === "BUY" && ctx.cash.lte(0) && new Decimal(review.orderAmount).gt(filled);
      return hold(review, cashLimited
        ? "No cash is left for the rest of this quarter's buy. The strategy holds what it has until buying power returns."
        : "This quarter's order is complete. Confirm to close the review.", explanation);
    }
    return trade(review, remaining, [...explanation, { label: "Remaining order", value: money(remaining), kind: "money" }], fallbackText);
  }

  let target: Decimal;
  let steps = 0;
  let anchorOverrideId: string | undefined;
  let periodIndex: number;
  let periodEnd: string;
  let newCashFrom: string;
  const explanation: ExplanationRow[] = [{ label: "Current strategy value", value: money(current), kind: "money" }];
  if (isInitial) {
    const total = current.plus(ctx.cash);
    if (total.lte(0)) return dataRequired(ctx, base, "Add cash or record your holdings", "This strategy has no cash and no holdings recorded, so there is nothing to allocate. Record a contribution or your opening holdings first.");
    target = total.mul(ratio(ctx.config, "initialTargetRatio"));
    // Wealtharr convention: the first review covers the calendar quarter in progress.
    const covered = calendarQuarterEndAt(period.index + 1, calendar);
    periodIndex = covered.index;
    periodEnd = covered.nominalDate;
    newCashFrom = ctx.now.toISOString();
    explanation.push({ label: "Initial target", value: money(target), kind: "money" });
  } else {
    steps = period.index - (lastIndex as number);
    const override = ctx.state[KELLY_ANCHOR_OVERRIDE_KEY] as { id?: unknown; value?: unknown } | undefined;
    let anchorRaw: unknown = ctx.state.anchorValue ?? ctx.state.targetValue;
    if (override != null) {
      if (typeof override.id !== "string" || !UUID_RE.test(override.id) || typeof override.value !== "string")
        return dataRequired(ctx, base, "Target override needs attention", "The saved target override is unreadable.");
      anchorRaw = override.value;
      anchorOverrideId = override.id;
    }
    let anchor: Decimal;
    try { anchor = new Decimal(String(anchorRaw)); } catch { anchor = new Decimal(NaN); }
    if (!anchor.isFinite() || anchor.lt(0)) return dataRequired(ctx, base, "Saved target needs attention", "The previous quarter's reference balance is invalid. Reconcile the strategy before trading.");
    const growth = new Decimal(1).plus(ratio(ctx.config, "targetRate")).pow(steps);
    const halfNewCash = ledger.newCash.mul(ratio(ctx.config, "contributionTargetRatio"));
    target = anchor.mul(growth).plus(halfNewCash);
    periodIndex = period.index;
    periodEnd = period.nominalDate;
    newCashFrom = period.cutoff.toISOString();
    explanation.push(
      { label: anchorOverrideId ? "Previous quarter reference (your override)" : "Previous quarter reference", value: money(anchor), kind: "money" },
      { label: "Quarters of growth", value: String(steps), kind: "text" },
      { label: "New cash this quarter", value: money(ledger.newCash), kind: "money" },
      { label: "Signal line", value: money(target), kind: "money" }
    );
  }
  // Never commit or trade toward a zero or negative line.
  if (!target.isFinite() || target.lte(0)) return dataRequired(ctx, base, "Signal line needs attention", "The calculated signal line is zero, so no trade or review can be recorded. Record a contribution or reconcile the strategy.", explanation);

  const opened = (side: "BUY" | "SELL", orderAmount: Decimal): OpenReview => ({
    periodIndex, periodEnd, newCashFrom, side, orderAmount: orderAmount.toString(), signalLine: target.toString(),
    openedAt: ctx.now.toISOString(), initial: isInitial, steps, ...(anchorOverrideId ? { anchorOverrideId } : {})
  });
  const closing = { periodIndex, periodEnd, newCashFrom, signalLine: target.toString(), anchorOverrideId };
  const gap = target.minus(current).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  explanation.push({ label: "Calculated adjustment", value: money(gap), kind: "money" });
  if (gap.eq(0)) return hold(closing, "The holding is exactly on the signal line. Confirm to close this quarter's review.", explanation);
  if (gap.gt(0)) {
    // R9 (author-sourced, 2018, possibly outdated): cap sized once, from cash at review start.
    const cap = Decimal.max(ctx.cash, 0).mul(ratio(ctx.config, "reviewBuyCapRatio")).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const order = Decimal.min(gap, cap);
    explanation.push({ label: "Buying-power cap this quarter", value: money(cap), kind: "money" });
    if (order.lte(0)) return hold(closing, "The strategy calls for a buy, but no cash is available. Under the strategy rules it holds what it has until buying power returns; no outside cash is required.", explanation);
    return trade(opened("BUY", order), order, explanation, fallbackText);
  }
  const order = gap.abs();
  return trade(opened("SELL", order), order, explanation, fallbackText);
}
