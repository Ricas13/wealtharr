import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
import {ivyTenMonthSignals} from "../src/domain/strategy/ivy-signals";
import type {TrustedHistoricalSeries} from "../src/domain/strategy/types";
const assets=["US_STOCKS","INTL_STOCKS","TREASURIES","REITS","COMMODITIES"];
function history():TrustedHistoricalSeries[]{
 return assets.map((exposure,index)=>({
  exposure,currency:"USD",source:"licensed",
  points:Array.from({length:10},(_,i)=>({
   at:new Date(Date.UTC(2026,i,28)),
   adjustedClose:new Decimal(index%2===0?100+i:120-i)
  }))
 }));
}
describe("Ivy reference signals",()=>{
 it("determines independent invest/cash sleeves from 10 monthly closes",()=>{
  const result=ivyTenMonthSignals(assets,history(),"2026-10","USD");
  expect(result.map(x=>x.invested)).toEqual([true,false,true,false,true]);
 });
 it("blocks an absent calendar month",()=>{
  const h=history();h[0].points.splice(3,1);
  expect(()=>ivyTenMonthSignals(assets,h,"2026-10","USD")).toThrow("IVY_HISTORY_GAP");
 });
 it("blocks duplicate and mismatched data",()=>{
  const h=history();h[0].points.push({...h[0].points[0]});
  expect(()=>ivyTenMonthSignals(assets,h,"2026-10","USD")).toThrow("IVY_MULTIPLE_MONTHLY_CLOSES");
  const c=history();c[0].currency="GBP";
  expect(()=>ivyTenMonthSignals(assets,c,"2026-10","USD")).toThrow("IVY_HISTORY_MISSING_OR_AMBIGUOUS");
 });
 it("routes exact SMA equality to defensive bills by Wealtharr convention",()=>{
  const h=history();h[0].points=h[0].points.map(p=>({...p,adjustedClose:new Decimal(100)}));
  expect(ivyTenMonthSignals(assets,h,"2026-10","USD")[0].invested).toBe(false);
 });
});
