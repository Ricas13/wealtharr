import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
const D=(n:number|string)=>new Decimal(n);
import {equalRiskContribution} from "../src/domain/strategy/tactical-math";
describe("risk-parity canonical golden",()=>{
 it("independent two-asset inverse-vol exact result, 1 vs 4 variance",()=>{
  const w=equalRiskContribution([[D(1),D(0)],[D(0),D(4)]]);
  expect(Number(w[0])).toBeCloseTo(2/3,10);
  expect(Number(w[1])).toBeCloseTo(1/3,10);
  expect(new Decimal(w[0]).div(w[1]).toNumber()).toBeCloseTo(2,9);
 });
});
