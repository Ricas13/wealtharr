import {describe,expect,it} from "vitest";
import {hasApprovedCustomerStrategyCatalogue,type StrategyEvidenceRow} from "@/lib/strategy-evidence";
const signed:StrategyEvidenceRow={key:"example",name:"Example",version:"1.0",lifecycle:"PUBLISHED",attested:true};
describe("paid strategy catalogue launch protection",()=>{
 it("refuses to bill users when there are no shipped strategies",()=>{
   expect(hasApprovedCustomerStrategyCatalogue([])).toBe(false);
 });
 it("refuses an incomplete or unsigned customer-visible release",()=>{
   expect(hasApprovedCustomerStrategyCatalogue([{...signed,attested:false}])).toBe(false);
   expect(hasApprovedCustomerStrategyCatalogue([{...signed,lifecycle:"DRAFT"}])).toBe(false);
   expect(hasApprovedCustomerStrategyCatalogue([signed,{...signed,key:"other",attested:false}])).toBe(false);
 });
 it("allows the attestation precondition only when all published releases are signed",()=>{
   expect(hasApprovedCustomerStrategyCatalogue([signed])).toBe(true);
   expect(hasApprovedCustomerStrategyCatalogue([signed,{...signed,key:"another"}])).toBe(true);
 });
});
