import {describe,expect,it} from "vitest";
import {projectSigTimeline} from "../src/domain/strategy/sig-timeline-research";
describe("quarterly Sig signal-only timeline",()=>{
  it("honours confirmed post-review anchors when purchases are underfunded",()=>{
    const quarters=projectSigTimeline("9sig",[
      {quarter:"2026-Q1",anchor:"6000",newCash:"0",observedExposure:"7200"},
      {quarter:"2026-Q2",anchor:"6540",newCash:"0",observedExposure:"4578"},
      {quarter:"2026-Q3",anchor:"7128.60",newCash:"0",observedExposure:"3564.30"},
      {quarter:"2026-Q4",anchor:"5462.76",newCash:"0",observedExposure:"6009.04"}
    ]);
    expect(quarters.map(x=>x.target)).toEqual(["6540","7128.6","7770.174","5954.4084"]);
    expect(quarters.map(x=>x.indicativeDirection)).toEqual(["SELL","BUY","BUY","SELL"]);
    expect(quarters[3].gap).toBe("-54.6316");
  });
  it("rejects skipped or duplicated quarters instead of silently compressing target growth",()=>{
    const first={quarter:"2026-Q1",anchor:"100",newCash:"0",observedExposure:"100"};
    expect(()=>projectSigTimeline("3sig",[first,{...first,quarter:"2026-Q3"}])).toThrow("SIG_MISSING_QUARTER");
    expect(()=>projectSigTimeline("6sig",[first,first])).toThrow("SIG_QUARTERS_NOT_ASCENDING");
    expect(()=>projectSigTimeline("9sig",[{...first,quarter:"not-quarter"}])).toThrow("INVALID_SIG_QUARTER");
  });
});
