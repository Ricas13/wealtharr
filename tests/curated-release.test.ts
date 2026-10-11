import {describe,expect,it} from "vitest";
import {assertCuratedRules,CANONICAL_9SIG_CONFIG} from "@/domain/strategy/curated-release";
import {RESEARCH_STRATEGIES} from "@/domain/strategy/research-catalog";
const hfea=RESEARCH_STRATEGIES.find(p=>p.key==="hfea")!;
describe("curated strategy rules cannot be edited through admin configuration",()=>{
 it("accepts exact canonical 9Sig and HFEA variants",()=>{
  expect(()=>assertCuratedRules("9sig","VALUE_TARGET",CANONICAL_9SIG_CONFIG,[])).not.toThrow();
  expect(()=>assertCuratedRules("hfea","FIXED_ALLOCATION",hfea.config,[])).not.toThrow();
 });
 it("rejects changing published HFEA to 60/40 while retaining the name",()=>{
  const changed={...hfea.config,allocations:[
    {exposure:"US_EQUITY_3X_LONG",weight:"0.60"},
    {exposure:"LONG_TREASURY_3X_LONG",weight:"0.40"}
  ]};
  expect(()=>assertCuratedRules("hfea","FIXED_ALLOCATION",changed,[]))
    .toThrow("CURATED_STRATEGY_RULES_IMMUTABLE");
 });
 it("rejects rebalancing frequency changes, overrides and arbitrary investor rule inputs",()=>{
  const altered={...hfea.config,reviewFrequency:"MONTHLY"};
  expect(()=>assertCuratedRules("hfea","FIXED_ALLOCATION",altered,[])).toThrow("CURATED_STRATEGY_RULES_IMMUTABLE");
  expect(()=>assertCuratedRules("hfea","FIXED_ALLOCATION",hfea.config,[{key:"weight_US_EQUITY_3X_LONG",type:"number"}]))
    .toThrow("CURATED_STRATEGY_RULES_IMMUTABLE");
 });
 it("does not allow arbitrary custom or research-only configurations to become tradeable",()=>{
  expect(()=>assertCuratedRules("my-special-strategy","FIXED_ALLOCATION",hfea.config,[]))
    .toThrow("CURATED_STRATEGY_NOT_VERIFIED");
  expect(()=>assertCuratedRules("3sig","VALUE_TARGET",CANONICAL_9SIG_CONFIG,[]))
    .toThrow("CURATED_STRATEGY_NOT_VERIFIED");
 });
 it("does not permit an administrator to alter 9Sig growth targets without a reviewed code release",()=>{
  expect(()=>assertCuratedRules("9sig","VALUE_TARGET",{...CANONICAL_9SIG_CONFIG,targetRate:"0.50"},[]))
    .toThrow("CURATED_STRATEGY_RULES_IMMUTABLE");
 });
});
