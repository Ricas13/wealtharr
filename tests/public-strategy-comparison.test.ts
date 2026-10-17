import {describe,expect,it} from "vitest";
import {
  alignedWindow,chartRows,modelComparisonMetadata,isApprovedModelPoint,
  isApprovedSpyPoint,validatedObservations,SPY_BENCHMARK_KEY,PUBLIC_MODEL_SOURCE
} from "../src/domain/public-strategy-comparison";

const model=[{date:"2025-10-15",value:"100"},{date:"2026-01-15",value:"110"},
  {date:"2026-04-15",value:"105"},{date:"2026-07-15",value:"130"},
  {date:"2026-10-15",value:"140"}];
const spy=[{date:"2025-10-15",value:"100"},{date:"2026-01-15",value:"105"},
  {date:"2026-04-15",value:"107"},{date:"2026-07-15",value:"112"},
  {date:"2026-10-15",value:"120"}];
const attested={
  provider:"Licensed price vendor",currency:"USD",commercialLicenceConfirmed:true,
  methodologyReviewed:true,cashFlowNeutral:true,dividendsAndFeesIncluded:true,
  points:model
};
describe("public strategy performance evidence",()=>{
  it("requires an explicit licensed adjusted total-return review before publishing",()=>{
    const approved=modelComparisonMetadata(attested);
    expect(approved).toMatchObject({publicationStatus:"PUBLIC_VERIFIED",returnBasis:"TOTAL_RETURN_INDEX",cashFlowNeutral:true});
    expect(isApprovedModelPoint(PUBLIC_MODEL_SOURCE,approved)).toBe(true);
    expect(isApprovedModelPoint("ADMIN",approved)).toBe(false);
    expect(isApprovedModelPoint(PUBLIC_MODEL_SOURCE,{})).toBe(false);
    expect(modelComparisonMetadata({...attested,commercialLicenceConfirmed:false})).toEqual({});
    expect(modelComparisonMetadata({...attested,currency:"GBP"})).toEqual({});
    expect(modelComparisonMetadata({...attested,points:[model[1],model[0]]})).toEqual({});
  });
  it("never publishes plain SPY prices or unlicensed/FX-adjusted unknown benchmarks",()=>{
    expect(SPY_BENCHMARK_KEY).toBe("SPY");
    const metadata={currency:"USD",returnBasis:"TOTAL_RETURN",licensed:true,adjusted:true,
      provenance:"ADMIN_ATTESTED",provider:"Licensed vendor"};
    expect(isApprovedSpyPoint("BENCHMARK_SPY",metadata)).toBe(true);
    expect(isApprovedSpyPoint("BENCHMARK_QQQ",metadata)).toBe(false);
    expect(isApprovedSpyPoint("BENCHMARK_SPY",{...metadata,licensed:false})).toBe(false);
    expect(isApprovedSpyPoint("BENCHMARK_SPY",{...metadata,adjusted:false})).toBe(false);
  });
  it("compares exact same start and end dates, rebased to 100",()=>{
    const comparison=alignedWindow(model,spy,"1Y","2026-10-17");
    expect(comparison?.model.start).toBe("2025-10-15");
    expect(comparison?.model.end).toBe("2026-10-15");
    expect(comparison?.model.percent).toBeCloseTo(40,7);
    expect(comparison?.spy.percent).toBeCloseTo(20,7);
    const rows=chartRows([{key:"model",points:model}],spy,"1Y","2026-10-17");
    expect(rows[0]).toMatchObject({date:"2025-10-15",SPY:100,model:100});
    expect(rows.at(-1)).toMatchObject({date:"2026-10-15",SPY:120,model:140});
  });
  it("will not invent interpolated prices when observation dates are different",()=>{
    const shifted=spy.map(row=>({...row,date:row.date.replace("-15","-16")}));
    expect(alignedWindow(model,shifted,"1Y","2026-10-17")).toBeNull();
    expect(chartRows([{key:"model",points:model}],shifted,"1Y","2026-10-17")).toEqual([]);
  });
  it("rejects stale history, partial periods, and duplicate or invalid values",()=>{
    expect(alignedWindow(model,spy,"3Y","2026-10-17")).toBeNull();
    expect(alignedWindow(model,spy,"1Y","2027-02-10")).toBeNull();
    expect(validatedObservations([model[0],model[0]])).toEqual([]);
    expect(validatedObservations([{date:"2025-10-15",value:"-1"}])).toEqual([]);
    expect(validatedObservations([{date:"2025-02-30",value:"100"}])).toEqual([]);
  });
  it("requires selected strategies to overlap on precise dates with SPY",()=>{
    const other=[{date:"2025-10-15",value:"100"},{date:"2026-10-15",value:"80"}];
    const rows=chartRows([{key:"a",points:model},{key:"b",points:other}],spy,"1Y","2026-10-17");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({a:100,b:100,SPY:100});
    expect(rows.at(-1)).toMatchObject({a:140,b:80,SPY:120});
    expect(chartRows([{key:"a",points:model},{key:"b",points:[{date:"2026-09-01",value:"100"},{date:"2026-09-02",value:"101"}]}],spy,"ALL","2026-10-17")).toEqual([]);
  });
});
