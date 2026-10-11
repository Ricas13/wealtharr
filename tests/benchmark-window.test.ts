import {describe,expect,it} from "vitest";
import {benchmarkComparison,type BenchmarkHistory} from "@/lib/workspace-analytics";

const actual=[{date:"2026-01-05",value:"1000"},{date:"2026-01-06",value:"1050"},{date:"2026-01-07",value:"1080"}];
const base:BenchmarkHistory={key:"spy",label:"SPY",currency:"GBP",points:[
  {date:"2026-01-05",value:"100"},{date:"2026-01-06",value:"103"},{date:"2026-01-07",value:"104"}
]};
describe("fail-closed, comparable full-window benchmark charts",()=>{
 it("accepts complete licensed benchmark timeline and cashflows",()=>{
  const c=benchmarkComparison(actual,[{date:"2026-01-06",amount:"100"}],"GBP",[base]);
  expect(c.comparisons.map(x=>x.key)).toEqual(["spy"]);
  expect(c.mapped.get("2026-01-05")?.spy).toBe(100);
  expect(c.mapped.get("2026-01-07")?.spy).toBeCloseTo(104,8);
 });
 it("does not display a benchmark whose history ends before the account does",()=>{
  const c=benchmarkComparison(actual,[],"GBP",[{...base,points:base.points.slice(0,-1)}]);
  expect(c.comparisons).toEqual([]);
  expect(c.missing).toContain("SPY");
 });
 it("does not display a different account currency or missing common observations",()=>{
  for(const b of [{...base,currency:"USD"},{...base,points:[base.points[0],base.points[2]]}]){
    expect(benchmarkComparison(actual,[],"GBP",[b]).missing).toContain("SPY");
  }
 });
 it("refuses unexplained holes even if the series has matching endpoints",()=>{
  const v=[{date:"2026-01-05",value:"1000"},{date:"2026-04-01",value:"1300"}];
  const b={...base,points:[{date:"2026-01-05",value:"100"},{date:"2026-04-01",value:"150"}]};
  expect(benchmarkComparison(v,[],"GBP",[b]).missing).toContain("SPY");
 });
 it("does not simulate future benchmark observations beyond the portfolio end",()=>{
  const c=benchmarkComparison(actual,[],"GBP",[{...base,points:[...base.points,{date:"2026-02-01",value:"300"}]}]);
  expect([...c.mapped.keys()].sort().at(-1)).toBe("2026-01-07");
 });
});
