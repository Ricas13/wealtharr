import {describe,it,expect} from "vitest";
import {benchmarkMetadata} from "../src/domain/benchmark-evidence";
const good={
 key:"vti",currency:"GBP",economicExposure:"BENCHMARK_VTI",provider:"licensed-provider",
 totalReturnAdjusted:true,commercialLicenceConfirmed:true,fxConversionVerified:true,
 points:[{date:"2026-09-01",value:"100"},{date:"2026-09-02",value:"101"}]
};
describe("benchmark evidence does not silently trust uploaded numbers",()=>{
 it("allows independently FX-converted, adjusted/licensed source values to be labelled",()=>{
  expect(benchmarkMetadata(good)).toMatchObject({currency:"GBP",returnBasis:"TOTAL_RETURN",licensed:true,fxConverted:true});
 });
 it("rejects non-licensed, unadjusted, unconverted and mismatched instruments",()=>{
  for(const bad of [
   {commercialLicenceConfirmed:false},{totalReturnAdjusted:false},{fxConversionVerified:false},
   {economicExposure:"BENCHMARK_QQQ"},{provider:""},{points:[good.points[0]]},
   {points:[good.points[0],good.points[0]]},{points:[{date:"2026-09-01",value:"-4"},good.points[1]]}
  ])expect(benchmarkMetadata({...good,...bad}),JSON.stringify(bad)).toEqual({});
 });
});
