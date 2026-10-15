import {describe,expect,it} from "vitest";
import {isNyseTradingDay,latestSigReference,nyseCloseInstant,quarterEndTradingDay,referenceHistoryDates} from "../src/domain/strategy/sig-nyse-quarters";

describe("NYSE quarter-end references (dates checked against the calendar by hand)",()=>{
  it("finds the last trading day of each 2026 quarter",()=>{
    // 2026-03-31 Tue, 2026-06-30 Tue, 2026-09-30 Wed, 2026-12-31 Thu: all open.
    expect([1,2,3,4].map(q=>quarterEndTradingDay(2026,q))).toEqual(["2026-03-31","2026-06-30","2026-09-30","2026-12-31"]);
  });
  it("steps back over a weekend: 2025-03-31 is a Monday, 2024-06-30 a Sunday so the last day is Friday 2024-06-28",()=>{
    expect(quarterEndTradingDay(2025,1)).toBe("2025-03-31");
    expect(quarterEndTradingDay(2024,2)).toBe("2024-06-28");
  });
  it("is not a trading day on weekends or on Good Friday 2026-04-03",()=>{
    expect(isNyseTradingDay("2026-10-03")).toBe(false);
    expect(isNyseTradingDay("2026-04-03")).toBe(false);
    expect(isNyseTradingDay("2026-10-02")).toBe(true);
  });
  it("counts the reference only from the 16:00 New York close",()=>{
    // 2026-09-30 15:59 EDT = 19:59Z; 16:00 EDT = 20:00Z.
    expect(latestSigReference(new Date("2026-09-30T19:59:00Z")).referenceDate).toBe("2026-06-30");
    expect(latestSigReference(new Date("2026-09-30T20:00:00Z")).referenceDate).toBe("2026-09-30");
  });
  it("counts trading days since the reference",()=>{
    expect(latestSigReference(new Date("2026-10-01T15:00:00Z")).tradingDaysSince).toBe(1);
    expect(latestSigReference(new Date("2026-10-05T15:00:00Z")).tradingDaysSince).toBe(3);
    expect(latestSigReference(new Date("2026-10-06T15:00:00Z")).tradingDaysSince).toBe(4);
  });
  it("uses New York calendar dates, not UTC: 2026-10-01 02:00Z is still 2026-09-30 evening in New York",()=>{
    const ref=latestSigReference(new Date("2026-10-01T02:00:00Z"));
    expect(ref.referenceDate).toBe("2026-09-30");
    expect(ref.tradingDaysSince).toBe(0);
  });
  it("lists nine consecutive quarter ends",()=>{
    expect(referenceHistoryDates(2026*4+2)).toEqual(["2024-09-30","2024-12-31","2025-03-31","2025-06-30","2025-09-30","2025-12-31","2026-03-31","2026-06-30","2026-09-30"]);
  });
  it("close instant follows daylight saving: 20:00Z in summer, 21:00Z in winter",()=>{
    expect(nyseCloseInstant("2026-09-30").toISOString()).toBe("2026-09-30T20:00:00.000Z");
    expect(nyseCloseInstant("2026-12-31").toISOString()).toBe("2026-12-31T21:00:00.000Z");
  });
});
