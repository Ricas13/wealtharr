import {describe,it,expect} from "vitest";
import {assessLinkedMarkets} from "@/domain/strategy/linked-market-eligibility";
import type {VerifiedCandidate} from "@/domain/strategy/market-eligibility";

const config={allocations:[{exposure:"US_EQUITY_3X_LONG",weight:"0.55"},
 {exposure:"LONG_TREASURY_3X_LONG",weight:"0.45"}]};
const m=(economicExposure:string,id:string,country:string,wrapper:string,currency:string,broker:string|null=null):VerifiedCandidate=>({
 id,economicExposure,leverage:"3",direction:"LONG",country,wrapper,broker,
 preferredCurrency:currency,fidelity:"EXACT",effectiveFrom:"2026-01-01",effectiveTo:null,
 tradingLineId:id,tradingLineCurrency:currency,tradingLineEffectiveFrom:"2026-01-01",
 tradingLineEffectiveTo:null,ticker:id,exchange:country==="GB"?"LSE":"NYSE"
});
const u={country:"US",wrapper:"TAXABLE",currency:"USD"};
const gb={country:"GB",wrapper:"ISA",currency:"GBP"};
const partial=[m("US_EQUITY_3X_LONG","SPY3","GB","ISA","GBP")];
const us=[m("US_EQUITY_3X_LONG","UPRO","US","TAXABLE","USD"),
          m("LONG_TREASURY_3X_LONG","TMF","US","TAXABLE","USD")];
describe("all required exposures must be valid for a selected market",()=>{
 it("blocks buying the available UK equity when its essential TMF duration leg is unsupported",()=>{
   const found=assessLinkedMarkets("FIXED_ALLOCATION",config,partial,[gb],"2026-10-09");
   expect(found.available).toBe(false);
   expect(found.eligibleAccountIndices).toEqual([]);
   expect(found.missingExposures).toContain("LONG_TREASURY_3X_LONG");
 });
 it("does not combine two incomplete accounts into one apparently valid strategy",()=>{
   const other={country:"GB",wrapper:"TAXABLE",currency:"GBP"};
   const candidates=[...partial,m("LONG_TREASURY_3X_LONG","TMB3","GB","TAXABLE","GBP")];
   expect(assessLinkedMarkets("FIXED_ALLOCATION",config,candidates,[gb,other],"2026-10-09").available).toBe(false);
 });
 it("allows a complete US implementation even when a separately linked ISA lacks instruments",()=>{
   const assessment=assessLinkedMarkets("FIXED_ALLOCATION",config,[...partial,...us],[gb,u],"2026-10-09");
   expect(assessment.available).toBe(true);
   expect(assessment.eligibleAccountIndices).toEqual([1]);
   expect(assessment.supportedMarkets).toContain("US / TAXABLE (USD)");
 });
 it("does not trust outdated or unverified legs",()=>{
   const expired=[us[0],{...us[1],tradingLineEffectiveTo:"2026-01-31"}];
   const uncertified=[us[0],{...us[1],fidelity:"CANDIDATE"}];
   expect(assessLinkedMarkets("FIXED_ALLOCATION",config,expired,[u],"2026-10-09").available).toBe(false);
   expect(assessLinkedMarkets("FIXED_ALLOCATION",config,uncertified,[u],"2026-10-09").available).toBe(false);
 });
 it("fails closed without investment accounts",()=>{
   expect(assessLinkedMarkets("FIXED_ALLOCATION",config,us,[],"2026-10-09").available).toBe(false);
 });
});
