import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
import {calculateTacticalAllocation,type TacticalRequest} from "../src/domain/strategy/tactical-allocation";
const D=(x:number|string)=>new Decimal(x);
const month=(y:number,m:number,i:number)=>new Date(Date.UTC(y,m+i,0));
function history(ids:string[],values:(id:string,i:number)=>number,count=13){
 return ids.map(exposure=>({exposure,currency:"USD",source:"licensed-provider",
  points:Array.from({length:count},(_,i)=>({at:month(2025,2,i),adjustedClose:D(values(exposure,i))}))}));
}
function request(overrides:Partial<TacticalRequest>):TacticalRequest {
 return {variant:"GEM_CLASSIC",currency:"USD",reviewMonth:"2026-02",
  asOf:new Date("2026-03-01T00:00:00Z"),riskAssets:["US","EXUS"],
  defensiveAssets:["TBILLS","BONDS"],history:history(["US","EXUS","TBILLS","BONDS"],
    (id,i)=>id==="US"?100+i:id==="EXUS"?100+i*2:id==="TBILLS"?100+i*.1:100+i*.2),
  calendarCertified:true,totalReturnCertified:true,...overrides};
}
describe("Group 4 tactical allocations",()=>{
 it("refuses unverified total-return data and uncertified calendars",()=>{
  expect(()=>calculateTacticalAllocation(request({calendarCertified:false}))).toThrow("TACTICAL_SOURCE_CERTIFICATION_REQUIRED");
  expect(()=>calculateTacticalAllocation(request({totalReturnCertified:false}))).toThrow("TACTICAL_SOURCE_CERTIFICATION_REQUIRED");
 });
 it("selects EXUS when above US, with positive US absolute momentum",()=>{
  expect(calculateTacticalAllocation(request({}))).toEqual([{exposure:"EXUS",weight:"1"}]);
 });
 it("switches to bonds when US underperforms T bills",()=>{
  const ids=["US","EXUS","TBILLS","BONDS"];
  expect(calculateTacticalAllocation(request({
   history:history(ids,(id,i)=>id==="US"?100-i:id==="EXUS"?100+i*2:id==="TBILLS"?100+i*.1:100+i*.2)
  }))).toEqual([{exposure:"BONDS",weight:"1"}]);
 });
 it("refuses missing defensive assets even when signal selects equities",()=>{
  expect(()=>calculateTacticalAllocation(request({history:request({}).history.filter(s=>s.exposure!=="BONDS")}))).toThrow("TACTICAL_MISSING_OR_AMBIGUOUS_HISTORY");
 });
 it("GTAA has independent twenty percent sleeves and a sixty percent safe allocation",()=>{
  const risk=["A","B","C","D","E"],safe=["TBILLS"];
  const h=history([...risk,...safe],(id,i)=>["A","B"].includes(id)?100+i:100-i);
  const result=calculateTacticalAllocation(request({variant:"IVY_GTAA5",riskAssets:risk,defensiveAssets:safe,history:h}));
  expect(result).toEqual([{exposure:"A",weight:"0.2"},{exposure:"B",weight:"0.2"},{exposure:"TBILLS",weight:"0.6"}]);
 });
});
