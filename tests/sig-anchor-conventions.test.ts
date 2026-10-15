import {describe,expect,it} from "vitest";
import {nextSigQuarterTarget} from "../src/domain/strategy/sig-anchor-conventions";
describe("9Sig anchor conventions must not silently mix across versions",()=>{
  const initial={precedingTarget:"7770.174",confirmedPostFillStockValue:"5462.76",
    nextQuarterCashAdded:"0",rate:"0.09"};
  it("post-fill convention explicitly compounds only completed stock exposure",()=>{
    expect(nextSigQuarterTarget({...initial,convention:"CONFIRMED_POST_FILL"}))
      .toEqual({anchor:"5462.76",growth:"491.6484",
        contributionsAddedToTarget:"0",target:"5954.4084"});
  });
  it("preceding-target alternative diverges materially in an underfunded quarter",()=>{
    const original=nextSigQuarterTarget({...initial,convention:"PRECEDING_SIGNAL_TARGET"});
    expect(original.target).toBe("8469.48966");
    const postFill=nextSigQuarterTarget({...initial,convention:"CONFIRMED_POST_FILL"});
    expect(Number(original.target)-Number(postFill.target)).toBeGreaterThan(2500);
  });
  it("accounts for half contributions and rejects missing conventions",()=>{
    expect(nextSigQuarterTarget({...initial,convention:"CONFIRMED_POST_FILL",nextQuarterCashAdded:"1000"}).target)
      .toBe("6454.4084");
    expect(()=>nextSigQuarterTarget({...initial,convention:"INVALID" as "CONFIRMED_POST_FILL"}))
      .toThrow("SIG_ANCHOR_CONVENTION_REQUIRED");
  });
});
