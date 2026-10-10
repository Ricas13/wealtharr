import { describe,it,expect } from "vitest";
import Decimal from "decimal.js";
import { assertCustomerPublishableEngine } from "../src/domain/strategy/registry";
import { RESEARCH_STRATEGIES } from "../src/domain/strategy/research-catalog";
import { fixedAllocationEngine } from "../src/domain/strategy/fixed-allocation";
describe("research catalog stays fail-closed",()=>{
  it("uses only HTTPS reference sources and nonempty risk disclosures",()=>{
    for(const profile of RESEARCH_STRATEGIES){
      expect(profile.research.length).toBeGreaterThan(0);
      expect(profile.research.every(url=>new URL(url).protocol==="https:")).toBe(true);
      expect(profile.risks.length).toBeGreaterThan(0);
      expect(profile.rules.length).toBeGreaterThan(30);
    }
  });

  it("refuses to publish research-only momentum engine",()=>{
    expect(()=>assertCustomerPublishableEngine("MOMENTUM_ROTATION")).toThrow("ENGINE_NOT_CUSTOMER_VERIFIED");
    expect(()=>assertCustomerPublishableEngine("FIXED_ALLOCATION")).not.toThrow();
  });
  it("uses unique keys and never auto-enables unverified strategies",()=>{
    expect(new Set(RESEARCH_STRATEGIES.map(x=>x.key)).size).toBe(RESEARCH_STRATEGIES.length);
    expect(RESEARCH_STRATEGIES.every(x=>x.launchState==="DRAFT_REQUIRES_VERIFICATION")).toBe(true);
  });
  it("validates every fixed-allocation profile and total weight",()=>{
    for(const profile of RESEARCH_STRATEGIES.filter(x=>x.engine==="FIXED_ALLOCATION")){
      expect(()=>fixedAllocationEngine.validateConfig(profile.config!)).not.toThrow();
      const allocations=profile.config!.allocations as {weight:string}[];
      expect(allocations.reduce((sum,a)=>sum.plus(a.weight),new Decimal(0)).eq(1)).toBe(true);
    }
  });
  it("never maps TQQQ to classic HFEA",()=>{
    const hfea=RESEARCH_STRATEGIES.find(x=>x.key==="hfea")!;
    expect(hfea.rules).toContain("NOT the original HFEA");
  });
  it("refuses to claim unimplemented momentum and Kelly variants are executable",()=>{
    expect(RESEARCH_STRATEGIES.filter(x=>["MOMENTUM_ROTATION","RESEARCH_PENDING"].includes(x.engine))
      .every(x=>x.config===undefined)).toBe(true);
  });
});
