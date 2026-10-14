import {describe,expect,it} from "vitest";
import {getStrategyPlugin} from "../src/domain/strategy/catalog";

const cases = [
  ["bernstein-no-brainer", [["US_LARGE_CAP","0.25"],["US_SMALL_CAP_BLEND","0.25"],["DEVELOPED_EX_US_SMALL_CAP_BLEND","0.25"],["US_SHORT_TREASURY","0.25"]]],
  ["larry-portfolio", [["US_SMALL_CAP_VALUE","0.14"],["DEVELOPED_EX_US_SMALL_CAP_VALUE","0.105"],["EMERGING_MARKETS_VALUE","0.035"],["US_FIVE_YEAR_TREASURY","0.72"]]],
  ["pinwheel", [["US_TOTAL_EQUITY","0.15"],["US_SMALL_CAP_VALUE","0.10"],["TOTAL_EX_US_EQUITY","0.15"],["EMERGING_MARKETS_EQUITY","0.10"],["US_INTERMEDIATE_TREASURY","0.15"],["US_TREASURY_BILLS","0.10"],["US_REITS","0.15"],["GOLD","0.10"]]]
] as const;

describe("Group 3 reference-only allocation evidence",()=>{
  for(const [key,expected] of cases){
    it(key+" matches documented sleeves without publishing incomplete implementation",()=>{
      const plugin=getStrategyPlugin(key);
      expect(plugin).toBeDefined();
      expect(plugin?.profile?.engine).toBe("FIXED_ALLOCATION");
      expect(plugin?.profile?.config?.allocations).toEqual(expected.map(([exposure,weight])=>({exposure,weight})));
      expect(expected.reduce((total,[,weight])=>total+Number(weight),0)).toBeCloseTo(1,12);
      expect(plugin?.seedDefinition).toBeNull();
      expect(plugin?.releaseStatus).not.toBe("COMPLETE");
    });
  }
  it("age-scaled and tactical methods remain intentionally nonpublishable",()=>{
    for(const key of ["two-funds-for-life","trinity"]){
      const plugin=getStrategyPlugin(key);
      expect(plugin?.profile?.engine).toBe("RESEARCH_PENDING");
      expect(plugin?.seedDefinition).toBeNull();
    }
  });
});
