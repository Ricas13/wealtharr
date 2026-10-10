import {describe,it,expect} from "vitest";
import {effectiveAllocations,fixedAllocationEngine} from "@/domain/strategy/fixed-allocation";

const cfg={allocations:[{exposure:"EQUITY",weight:"0.60"},{exposure:"BONDS",weight:"0.40"}],rebalanceThreshold:"0",reviewFrequency:"ANNUAL"};
describe("no customer custom strategy allocations, including legacy config",()=>{
 it("uses only the fixed code-authored weights with ordinary account settings",()=>{
  expect(effectiveAllocations(cfg,{broker:"Example"})).toEqual(cfg.allocations);
 });
 it("ignores no deceptive custom weight overrides: it blocks the calculation",()=>{
  expect(effectiveAllocations(cfg,{"weight_EQUITY":"0.95","weight_BONDS":"0.05"})).toBeNull();
  expect(effectiveAllocations({...cfg,userWeights:true},{})).toBeNull();
 });
 it("refuses any attempt to publish an editable-weight fixed-allocation engine version",()=>{
  expect(()=>fixedAllocationEngine.validateConfig({...cfg,userWeights:true}))
    .toThrow("CUSTOM_WEIGHTS_NOT_SUPPORTED");
 });
});
