import {describe,expect,it} from "vitest";
import {planSigSleeveTransfers} from "../src/domain/strategy/sig-two-sleeve-research";
describe("two invested sleeves in Sig, not cash-only",()=>{
 const base={stockValue:"3564.30",bondValue:"2109.40",uninvestedCash:"0",
 targetStockValue:"7770.174",confirmedStockBuysThisQuarter:"0",
 bondBalanceAtQuarterStart:"2109.40",maxQuarterBondUse:"0.9"};
 it("sells bonds first, then purchases leveraged equity using actual proceeds",()=>{
  const out=planSigSleeveTransfers(base);
  expect(out.legs).toEqual([{side:"SELL",sleeve:"BOND",amount:"1898.46"},
    {side:"BUY",sleeve:"STOCK",amount:"1898.46"}]);
  expect(out.residualGap).toBe("2307.414");
 });
 it("does not refresh the quarter bond budget after a partial fill",()=>{
  const out=planSigSleeveTransfers({...base,bondValue:"1109.40",
    stockValue:"4564.30",confirmedStockBuysThisQuarter:"1000"});
  expect(out.legs[0].amount).toBe("898.46");
 });
 it("routes excess equity sales into actual bond holdings",()=>{
  const out=planSigSleeveTransfers({...base,stockValue:"8000",
    targetStockValue:"7000",uninvestedCash:"100"});
  expect(out.legs).toEqual([{side:"SELL",sleeve:"STOCK",amount:"1000"},
    {side:"BUY",sleeve:"BOND",amount:"1100"}]);
 });
 it("cannot exceed remaining bond value or quarter cap",()=>{
  const out=planSigSleeveTransfers({...base,bondValue:"100",uninvestedCash:"0"});
  expect(out.legs[0].amount).toBe("100");
 });
});
