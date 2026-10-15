import {describe,expect,it} from "vitest";
import {previewHistoricalSigBaseReset} from "../src/domain/strategy/sig-historical-reset-preview";
describe("historical author-attested Sig base weights are not ordinary signals",()=>{
  it.each([["3sig-book","8000","2000"],["6sig-historical","5000","5000"],["9sig-historical","6000","4000"]] as const)(
    "%s stock/bond reset weights", (variant,stockTarget,bondTarget)=>{
      const preview=previewHistoricalSigBaseReset({variant,stockValue:"9000",bondValue:"1000",resetConfirmed:true});
      expect(preview.stockTarget).toBe(stockTarget);
      expect(preview.bondTarget).toBe(bondTarget);
      expect(preview.stockTrade).toBe((Number(stockTarget)-9000).toString());
      expect(preview.bondTrade).toBe((9000-Number(stockTarget)).toString());
    });
  it("suppresses trade without an explicitly verified reset trigger",()=>{
    const preview=previewHistoricalSigBaseReset({variant:"6sig-historical",
      stockValue:"9000",bondValue:"1000",resetConfirmed:false});
    expect(preview.ready).toBe(false);
    expect(preview.stockTrade).toBe("0");
  });
  it("rejects missing portfolio value and corrupt position",()=>{
    expect(()=>previewHistoricalSigBaseReset({variant:"9sig-historical",stockValue:"0",
      bondValue:"0",resetConfirmed:true})).toThrow("INVALID_SIG_RESET_VALUES");
  });
});
