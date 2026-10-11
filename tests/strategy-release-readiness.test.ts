import {describe,it,expect} from "vitest";
import {RESEARCH_STRATEGIES} from "@/domain/strategy/research-catalog";
import {researchGate,strategyReadiness,type StrategyReleaseEvidence} from "@/domain/strategy/release-readiness";
import type {VerifiedCandidate} from "@/domain/strategy/market-eligibility";
const profile=RESEARCH_STRATEGIES.find(p=>p.key==="hfea")!;
const release:StrategyReleaseEvidence={
 key:"hfea",enabled:false,version:"1.0",engineKey:"FIXED_ALLOCATION",
 lifecycleStatus:"PUBLISHED",config:profile.config!,inputSchema:[],
 specCard:"docs/strategy-specs/hfea.md",
 goldenTests:"tests/strategy-reference-golden.test.ts",attestedAt:"2026-10-09T08:00:00Z"
};
const candidate=(exposure:string,ticker:string):VerifiedCandidate=>({
 id:ticker,economicExposure:exposure,leverage:"3",direction:"LONG",country:"US",
 wrapper:"TAXABLE",broker:null,preferredCurrency:"USD",fidelity:"EXACT",
 effectiveFrom:"2026-01-01",effectiveTo:null,tradingLineId:ticker,
 tradingLineCurrency:"USD",tradingLineEffectiveFrom:"2026-01-01",
 tradingLineEffectiveTo:null,ticker,exchange:"NYSE"
});
const equities=candidate("US_EQUITY_3X_LONG","UPRO");
const treasuries=candidate("LONG_TREASURY_3X_LONG","TMF");
describe("Master Admin strategy readiness cannot invent approvals",()=>{
 it("shows partial market mapping as unavailable even with a purported source attestation",()=>{
  const g=researchGate(profile,release,[equities],"2026-10-09");
  expect(g.marketNames).toEqual([]);
  expect(g.state).toBe("No complete configured market");
  expect(g.missing).toContain("LONG_TREASURY_3X_LONG");
 });
 it("does not represent complete mapping as real-world certification",()=>{
  const g=researchGate(profile,release,[equities,treasuries],"2026-10-09");
  expect(g.marketNames).toEqual(["US / TAXABLE (USD)"]);
  expect(g.state).toBe("Eligible for operator review only");
 });
 it("does not trust mismatched stored weights or reissued unapproved versions",()=>{
  const changed={...release,config:{...release.config,allocations:[
   {exposure:"US_EQUITY_3X_LONG",weight:"0.99"},
   {exposure:"LONG_TREASURY_3X_LONG",weight:"0.01"}]}};
  expect(researchGate(profile,changed,[equities,treasuries],"2026-10-09").state)
    .toBe("Stored rules need code review");
  expect(researchGate(profile,{...release,attestedAt:null},[equities,treasuries],"2026-10-09").state)
    .toBe("Published: independent evidence missing");
 });
 it("research profiles without complete canonical code remain visibly blocked",()=>{
  const research=RESEARCH_STRATEGIES.find(p=>p.key==="merriman-ultimate")!;
  expect(researchGate(research,undefined,[equities,treasuries],"2026-10-09").state)
   .toBe("Research method incomplete");
  expect(strategyReadiness([],[],"2026-10-09")).toHaveLength(RESEARCH_STRATEGIES.length);
 });
});
