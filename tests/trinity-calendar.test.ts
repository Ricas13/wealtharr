import {describe,expect,it} from "vitest";
import {trinityNyseHolidays,trinityNyseHolidayWindow} from "../src/domain/strategy/trinity-calendar";
import {nextCalendarMonthDueAt} from "../src/domain/schedule";
import {trinitySignalCutoff} from "../src/domain/strategy/trinity-engine";

describe("Trinity NYSE calendar against official 2026-2028 schedule",()=>{
  it.each([
    [2026,["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25"]],
    [2027,["2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24"]],
    [2028,["2028-01-17","2028-02-21","2028-04-14","2028-05-29","2028-06-19","2028-07-04","2028-09-04","2028-11-23","2028-12-25"]]
  ])("NYSE %i regular full closures match its published calendar",(year,expected)=>{
    expect(trinityNyseHolidays(year)).toEqual(expected);
  });
  it("does not invent a New Year holiday when January 1 falls on Saturday",()=>{
    expect(trinityNyseHolidays(2028)).not.toContain("2027-12-31");
  });
  it("rolls a weekend month-end back to the final NYSE trading day",()=>{
    const date=nextCalendarMonthDueAt({
      lastReviewAt:new Date("2026-09-30T20:00:00Z"),
      timeZone:"America/New_York",holidays:trinityNyseHolidayWindow(new Date("2026-10-01T12:00:00Z"))
    });
    // October 31, 2026 is Saturday; Friday October 30 is final session.
    expect(date.toISOString().slice(0,10)).toBe("2026-10-30");
  });
  it("excludes uncompleted current month and pins the latest eligible month-end close",()=>{
    expect(trinitySignalCutoff(new Date("2026-11-05T12:00:00Z")).toISOString().slice(0,10)).toBe("2026-10-30");
    expect(trinitySignalCutoff(new Date("2026-12-31T22:00:00Z")).toISOString().slice(0,10)).toBe("2026-12-31");
  });
});
