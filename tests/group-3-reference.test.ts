import {describe,expect,it} from "vitest";
import {getStrategyPlugin} from "../src/domain/strategy/catalog";

const cases = [
  ["bernstein-no-brainer", [["G3_US_LARGE_CAP_BLEND","0.25"],["G3_US_SMALL_CAP_BLEND","0.25"],["G3_DEV_EX_US_SMALL_CAP_BLEND","0.25"],["G3_US_SHORT_TREASURY","0.25"]]],
  ["larry-portfolio", [["G3_US_SMALL_CAP_VALUE","0.14"],["G3_DEV_EX_US_SMALL_CAP_VALUE","0.105"],["G3_EM_VALUE","0.035"],["G3_US_FIVE_YEAR_TREASURY","0.72"]]],
  ["pinwheel", [["G3_US_LARGE_CAP_BLEND","0.15"],["G3_US_SMALL_CAP_VALUE","0.10"],["G3_DEV_EX_US_LARGE_CAP_BLEND","0.15"],["G3_EM_LARGE_CAP_BLEND","0.10"],["G3_US_INTERMEDIATE_TREASURY","0.15"],["G3_US_TREASURY_BILLS","0.10"],["G3_US_REITS","0.15"],["G3_PHYSICAL_GOLD","0.10"]]]
] as const;

describe("Group 3 reference-only allocation evidence",()=>{
  for(const [key,expected] of cases){
    it(key+" matches documented sleeves with a published code method gated by market evidence",()=>{
      const plugin=getStrategyPlugin(key);
      expect(plugin).toBeDefined();
      expect(plugin?.profile?.engine).toBe("FIXED_ALLOCATION");
      expect(plugin?.profile?.config?.allocations).toEqual(expected.map(([exposure,weight])=>({exposure,weight})));
      expect(expected.reduce((total,[,weight])=>total+Number(weight),0)).toBeCloseTo(1,12);
      expect(plugin?.seedDefinition?.enabled).toBe(false);
      expect(plugin?.seedDefinition?.initialVersion).toBe("PUBLISHED");
      expect(plugin?.releaseStatus).toBe("COMPLETE");
    });
  }
  it("age-scaled and tactical methods remain intentionally nonpublishable",()=>{
    for(const key of ["trinity"]){
      const plugin=getStrategyPlugin(key);
      expect(plugin?.profile?.engine).toBe("RESEARCH_PENDING");
      expect(plugin?.seedDefinition).toBeNull();
    }
  });
});
