import { describe, expect, it } from "vitest";
import { buildTrustedSeries, type HistoryRow } from "../src/domain/trusted-history";

const NOW = new Date("2026-10-09T12:00:00Z");
const rules = { now: NOW, currency: "GBP", minSpanDays: 20, maxAgeDays: 4 };
const row = (tradingDay: string, over: Partial<HistoryRow> = {}): HistoryRow => ({ tradingDay, adjustedClose: "100", currency: "GBP", provider: "p", licensed: true, adjustmentVerified:true, ...over });
// Business days 2026-09-14 .. 2026-10-08, covering 25 days.
const days = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];

describe("trusted history", () => {
  it("accepts a licensed, fresh, gap-free series and orders it by day", () => {
    const series = buildTrustedSeries("GOLD", [...days].reverse().map((d) => row(d)), rules);
    expect(series?.points).toHaveLength(days.length);
    expect(series?.points[0].at.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(series?.source).toBe("p");
  });
  it("rejects legacy rows flagged licensed before corporate-action adjustment was verified",()=>{
    expect(buildTrustedSeries("GOLD",days.map((d,i)=>row(d,{adjustmentVerified:i!==4})),rules)).toBeNull();
  });
  it("rejects any unlicensed row", () => {
    expect(buildTrustedSeries("GOLD", days.map((d, i) => row(d, { licensed: i !== 3 })), rules)).toBeNull();
  });
  it("rejects mixed providers and mixed currencies", () => {
    expect(buildTrustedSeries("GOLD", days.map((d, i) => row(d, { provider: i === 2 ? "q" : "p" })), rules)).toBeNull();
    expect(buildTrustedSeries("GOLD", days.map((d, i) => row(d, { currency: i === 2 ? "USD" : "GBP" })), rules)).toBeNull();
  });
  it("rejects a stale tail, a short span and a large gap", () => {
    expect(buildTrustedSeries("GOLD", days.slice(0, -4).map((d) => row(d)), rules)).toBeNull();
    expect(buildTrustedSeries("GOLD", days.slice(-6).map((d) => row(d)), rules)).toBeNull();
    expect(buildTrustedSeries("GOLD", days.filter((d) => !["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"].includes(d)).map((d) => row(d)), rules)).toBeNull();
  });
  it("rejects impossible calendar dates and any future observations",()=>{
    expect(buildTrustedSeries("GOLD",days.map((d,i)=>row(i===3?"2026-02-30":d)),rules)).toBeNull();
    expect(buildTrustedSeries("GOLD",[...days.slice(0,-1).map(d=>row(d)),row("2026-12-31")],rules)).toBeNull();
    expect(buildTrustedSeries("GOLD",days.map(d=>row(d)),{...rules,now:new Date("invalid")})).toBeNull();
  });
  it("rejects duplicate days, non-positive and non-numeric prices, and empty input", () => {
    expect(buildTrustedSeries("GOLD", [...days.map((d) => row(d)), row("2026-10-08")], rules)).toBeNull();
    expect(buildTrustedSeries("GOLD", days.map((d, i) => row(d, { adjustedClose: i === 4 ? "0" : "100" })), rules)).toBeNull();
    expect(buildTrustedSeries("GOLD", days.map((d, i) => row(d, { adjustedClose: i === 4 ? "abc" : "100" })), rules)).toBeNull();
    expect(buildTrustedSeries("GOLD", [], rules)).toBeNull();
  });
});

import { acceptHistoryObservation } from "../src/domain/trusted-history";
describe("history observations from a provider", () => {
  const good = { price: "101.5", currency: "GBP", observedAt: new Date("2026-10-08T21:00:00Z"), granularity: "DAILY_BAR", priceKind: "CLOSE", corporateActionsAdjusted: true };
  it("accepts only a daily CLOSE dated that day in the line's currency", () => {
    expect(acceptHistoryObservation(good, "2026-10-08", "GBP")).toBe(true);
    expect(acceptHistoryObservation({ ...good, currency: "gbp" }, "2026-10-08", "GBP")).toBe(true);
    expect(acceptHistoryObservation(null, "2026-10-08", "GBP")).toBe(false);
    expect(acceptHistoryObservation({ ...good, priceKind: "LAST" }, "2026-10-08", "GBP")).toBe(false);
    expect(acceptHistoryObservation({ ...good, granularity: "MINUTE_BAR" }, "2026-10-08", "GBP")).toBe(false);
    expect(acceptHistoryObservation({ ...good, granularity: undefined }, "2026-10-08", "GBP")).toBe(false);
    expect(acceptHistoryObservation({ ...good, corporateActionsAdjusted: false }, "2026-10-08", "GBP")).toBe(false);
    expect(acceptHistoryObservation({ ...good, corporateActionsAdjusted: undefined }, "2026-10-08", "GBP")).toBe(false);
    expect(acceptHistoryObservation({ ...good, observedAt: new Date("invalid") }, "2026-10-08", "GBP")).toBe(false);
    expect(acceptHistoryObservation(good, "2026-02-30", "GBP")).toBe(false);
    expect(acceptHistoryObservation({ ...good, currency: "USD" }, "2026-10-08", "GBP")).toBe(false);
    expect(acceptHistoryObservation(good, "2026-10-09", "GBP")).toBe(false); // previous session returned for a holiday
    expect(acceptHistoryObservation({ ...good, price: "0" }, "2026-10-08", "GBP")).toBe(false);
    expect(acceptHistoryObservation({ ...good, price: "x" }, "2026-10-08", "GBP")).toBe(false);
  });
});
