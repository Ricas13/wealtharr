import {describe,it,expect} from "vitest";
import {calculateInstrument,illustrativeReviewDate,EXAMPLE_INITIAL_MINOR} from "../src/domain/public-allocation-observatory";

describe("public allocation observatory illustrative maths",()=>{
 it("starts with real arithmetic and no fictional price series",()=>{
  const result=calculateInstrument(500,60);
  expect(result.totalMinor).toBe(1_050_000);
  expect(result.currentEquityPct).toBe(64);
  expect(result.equityTargetMinor).toBe(630_000);
  expect(result.bondTargetMinor).toBe(420_000);
  expect(result.equityGapMinor).toBe(-10_000);
  expect(result.bondGapMinor).toBe(60_000);
  expect(result.equityGapMinor+result.bondGapMinor).toBe(50_000);
 });
 it("changes all outputs with the target but not the recorded holdings",()=>{
  const original=calculateInstrument(500,60),changed=calculateInstrument(500,70);
  expect(changed.equityCurrentMinor).toBe(original.equityCurrentMinor);
  expect(changed.bondCurrentMinor).toBe(original.bondCurrentMinor);
  expect(changed.equityTargetMinor).toBe(735_000);
  expect(changed.equityGapMinor).toBe(95_000);
  expect(changed.bondGapMinor).toBe(-45_000);
 });
 it("conserves cash and leaves no value invented for every supported input",()=>{
  for(let contribution=0;contribution<=2000;contribution+=100){
   for(let target=30;target<=80;target+=5){
    const x=calculateInstrument(contribution,target);
    expect(x.totalMinor).toBe(EXAMPLE_INITIAL_MINOR+contribution*100);
    expect(x.equityTargetMinor+x.bondTargetMinor).toBe(x.totalMinor);
    expect(x.equityGapMinor+x.bondGapMinor).toBe(x.contributionMinor);
    expect(Number.isSafeInteger(x.equityTargetMinor)).toBe(true);
    expect(Number.isSafeInteger(x.bondTargetMinor)).toBe(true);
   }
  }
 });
 it("rejects invalid targets, non-integer contributions and extreme values",()=>{
  for(const [contribution,target] of [[-100,60],[3000,60],[0,0],[0,60.1],[0,83],[100.5,60],[NaN,60],[0,NaN]]){
   expect(()=>calculateInstrument(contribution,target)).toThrow();
  }
 });
 it("uses a labelled fixed illustrative date instead of pretending to schedule actual strategy runs",()=>{
  expect(illustrativeReviewDate(30)).toBe("15 Nov 2026");
  expect(illustrativeReviewDate(90)).toBe("14 Jan 2027");
  expect(illustrativeReviewDate(365)).toBe("16 Oct 2027");
 });
});
