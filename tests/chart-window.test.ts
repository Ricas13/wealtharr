import {describe,expect,it} from "vitest";
import {rebaseIndexedWindow,periodCutoffIso} from "@/domain/chart-window";

describe("selected-period benchmark comparison",()=>{
 it("starts actual, model and benchmarks at 100 on the selected first valuation",()=>{
  const rows=rebaseIndexedWindow([
   {date:"2026-06-01",actual:125,model:110,benchmark:102,benchmarkValues:{spy:120,qqq:140}},
   {date:"2026-07-01",actual:150,model:99,benchmark:107.1,benchmarkValues:{spy:126,qqq:133}}
  ]);
  expect(rows[0]).toMatchObject({actual:100,model:100,benchmark:100,benchmarkValues:{spy:100,qqq:100}});
  expect(rows[1].actual).toBeCloseTo(120);
  expect(rows[1].model).toBeCloseTo(90);
  expect(rows[1].benchmark).toBeCloseTo(105);
  expect(rows[1].benchmarkValues?.spy).toBeCloseTo(105);
  expect(rows[1].benchmarkValues?.qqq).toBeCloseTo(95);
 });
 it("refuses a benchmark starting after the period start instead of claiming comparable growth",()=>{
  const rows=rebaseIndexedWindow([
   {date:"2026-06-01",actual:100,benchmarkValues:{spy:100}},
   {date:"2026-06-02",actual:103,benchmarkValues:{spy:104,qqq:50}}
  ]);
  expect(rows[1].benchmarkValues?.qqq).toBeUndefined();
  expect(rows[1].benchmarkValues?.spy).toBe(104);
 });
 it("refuses zero, negative or invalid baselines and does not mutate the original points",()=>{
  const raw=[{date:"2026-06-01",actual:0,model:100,benchmarkValues:{spy:-100}},
   {date:"2026-06-02",actual:20,model:110,benchmarkValues:{spy:50}}];
  const rows=rebaseIndexedWindow(raw);
  expect(rows[1].actual).toBeUndefined();
  expect(rows[1].benchmarkValues?.spy).toBeUndefined();
  expect(rows[1].model).toBeCloseTo(110);
  expect(raw[0].model).toBe(100);
  expect(rebaseIndexedWindow([])).toEqual([]);
 });
});

describe("calendar-aligned chart date filter",()=>{
 it("clamps month-end lookbacks rather than silently rolling February into March",()=>{
  expect(periodCutoffIso("1M","2026-03-31")).toBe("2026-02-28");
  expect(periodCutoffIso("1M","2024-03-31")).toBe("2024-02-29");
  expect(periodCutoffIso("3M","2026-05-31")).toBe("2026-02-28");
 });
 it("handles YTD, trailing years and daily/week filters",()=>{
  expect(periodCutoffIso("YTD","2026-10-09")).toBe("2026-01-01");
  expect(periodCutoffIso("1Y","2026-10-09")).toBe("2025-10-09");
  expect(periodCutoffIso("5Y","2026-10-09")).toBe("2021-10-09");
  expect(periodCutoffIso("1D","2026-01-01")).toBe("2025-12-31");
  expect(periodCutoffIso("1W","2026-01-05")).toBe("2025-12-29");
  expect(periodCutoffIso("CUSTOM","2026-10-09")).toBeNull();
  expect(periodCutoffIso("MAX","2026-10-09")).toBeNull();
 });
});
