import { describe, expect, it } from "vitest";
import { addMonthsIso, nextReviewDueAt, nextCalendarQuarterDueAt, rollBusinessDay, zonedLocalDateTimeToUtc } from "../src/domain/schedule";

describe("review scheduling", () => {
  it("handles month-end without spilling into the following month", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("rolls weekends and configured holidays", () => {
    expect(rollBusinessDay("2026-02-28", [], "PREVIOUS")).toBe("2026-02-27");
    expect(rollBusinessDay("2026-12-25", ["2026-12-25"], "PREVIOUS")).toBe("2026-12-24");
  });

  it("converts London cutoff correctly across DST", () => {
    expect(zonedLocalDateTimeToUtc("2026-01-15", "16:00", "Europe/London").toISOString()).toBe("2026-01-15T16:00:00.000Z");
    expect(zonedLocalDateTimeToUtc("2026-07-15", "16:00", "Europe/London").toISOString()).toBe("2026-07-15T15:00:00.000Z");
  });

  it("produces a timezone-aware business-day review instant", () => {
    const due = nextReviewDueAt({
      lastReviewAt: new Date("2026-01-31T12:00:00Z"),
      frequency: "MONTHLY",
      timeZone: "Europe/London",
      cutoffLocal: "16:00"
    });
    expect(due.toISOString()).toBe("2026-02-27T16:00:00.000Z");
  });

  it("aligns HFEA-style reviews to calendar quarter ends rather than users' start dates",()=>{
    const one=nextCalendarQuarterDueAt({lastReviewAt:new Date("2026-11-02T18:00:00Z"),timeZone:"America/New_York"});
    const two=nextCalendarQuarterDueAt({lastReviewAt:new Date("2026-10-12T18:00:00Z"),timeZone:"America/New_York"});
    expect(one.toISOString()).toBe("2026-12-31T21:00:00.000Z");
    expect(two.toISOString()).toBe(one.toISOString());
    expect(nextCalendarQuarterDueAt({lastReviewAt:one,timeZone:"America/New_York"}).toISOString())
      .toBe("2027-03-31T20:00:00.000Z");
  });
  it("rolls calendar-quarter weekend and configured holiday to previous trading day",()=>{
    expect(nextCalendarQuarterDueAt({lastReviewAt:new Date("2026-01-07T00:00:00Z"),timeZone:"UTC"}).toISOString())
      .toBe("2026-03-31T16:00:00.000Z");
    expect(nextCalendarQuarterDueAt({lastReviewAt:new Date("2026-06-01T12:00:00Z"),
      timeZone:"UTC",holidays:["2026-06-30"]}).toISOString()).toBe("2026-06-29T16:00:00.000Z");
  });
  it("supports semi-annual and threshold-only cadences and refuses unknown ones", () => {
    const base = { lastReviewAt: new Date("2026-01-15T12:00:00Z"), timeZone: "UTC", cutoffLocal: "16:00" };
    expect(nextReviewDueAt({ ...base, frequency: "SEMIANNUAL" }).toISOString()).toBe("2026-07-15T16:00:00.000Z");
    expect(nextReviewDueAt({ ...base, frequency: "ANNUAL" }).toISOString()).toBe("2027-01-15T16:00:00.000Z");
    // Threshold-only: due again the same business day, so every check compares drift with the threshold.
    expect(nextReviewDueAt({ ...base, frequency: "THRESHOLD_ONLY" }).toISOString()).toBe("2026-01-15T16:00:00.000Z");
    expect(() => nextReviewDueAt({ ...base, frequency: "FORTNIGHTLY" })).toThrow("UNSUPPORTED_REVIEW_FREQUENCY");
    expect(() => nextReviewDueAt({ ...base, frequency: "toString" })).toThrow("UNSUPPORTED_REVIEW_FREQUENCY");
  });
});
