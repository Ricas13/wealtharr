import {describe,expect,it} from "vitest";
import {calendarQuarterReviewDates} from "../src/domain/strategy/sig-calendar-quarter";
const days=Array.from({length:12},(_,i)=>{
 const y=2023+Math.floor(i/4),q=i%4+1;
 return new Date(Date.UTC(y,q*3,0)).toISOString().slice(0,10);
});
describe("owner-defined quarter-end review calendar",()=>{
 it("takes last listed trading day of each completed calendar quarter",()=>{
  const actual=calendarQuarterReviewDates(days,"2025-12-31");
  expect(actual).toHaveLength(9);
  expect(actual.at(-1)).toBe("2025-12-31");
 });
 it("rejects insufficient, unordered and duplicate calendars",()=>{
  expect(()=>calendarQuarterReviewDates(days.slice(-4),"2025-12-31")).toThrow("SIG_NINE_COMPLETE_QUARTERS_REQUIRED");
  expect(()=>calendarQuarterReviewDates([days[1],days[0],...days.slice(2)],"2025-12-31"))
   .toThrow("SIG_INVALID_TRADING_CALENDAR");
 });
});
