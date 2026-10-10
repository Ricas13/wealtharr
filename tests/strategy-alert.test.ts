import {describe,it,expect} from "vitest";
import {buildStrategyAlert} from "@/domain/strategy-alert";
const now=new Date("2026-10-09T17:00:00Z");
const base={actionType:"BUY",amount:"1234.567",currency:"GBP",ticker:"SPY3",calculatedAt:now,brand:"Wealtharr"};
describe("safe, actionable strategy review notification",()=>{
 it("includes indicative amount, ticker, currency and timestamp but always tells the user to verify",()=>{
  const alert=buildStrategyAlert(base);
  expect(alert.body).toContain("Indicative buy: 1234.57 GBP of SPY3.");
  expect(alert.body).toContain("2026-10-09T17:00:00.000Z");
  expect(alert.body).toContain("confirm the order before trading");
  expect(alert.body).toContain("not a trade order");
 });
 it("handles sales and hold reviews without inventing trading instructions",()=>{
  expect(buildStrategyAlert({...base,actionType:"SELL"}).body).toContain("Indicative sell");
  expect(buildStrategyAlert({...base,actionType:"HOLD",amount:null}).body).toContain("no buy or sell");
 });
 it("does not show a trade amount when source evidence is missing",()=>{
  for(const b of [{...base,actionType:"DATA_REQUIRED"},
      {...base,amount:"NaN"},{...base,ticker:null}])
    expect(buildStrategyAlert(b).body).not.toContain("Indicative buy");
 });
});
