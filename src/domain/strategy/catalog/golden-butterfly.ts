import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/** Frozen US-reference economic method; account-specific listings remain gated by EXACT mappings. */
export const plugin:StrategyPlugin={
 key:"golden-butterfly",
 profile:{key:"golden-butterfly",name:"Golden Butterfly — US reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
  config:fixed([["G1_US_LARGE_BLEND","0.20"],["G1_US_SMALL_VALUE","0.20"],["G1_US_LONG_TREASURY","0.20"],["G1_US_SHORT_TREASURY","0.20"],["G1_PHYSICAL_GOLD","0.20"]],"ANNUAL"),
  rules:"Portfolio Charts describes five equal 20% sleeves. The annual zero-threshold rebalance is a Wealtharr execution convention, not a uniquely prescribed rule from the original portfolio. Method: annually rebalance to fixed weights with zero drift threshold on review; add available strategy cash to the portfolio before evaluating target weights. Fees, broker lot sizes and cash residue use the shared execution engine.",
  research:["https://portfoliocharts.com/portfolios/golden-butterfly-portfolio/"],
  risks:["Market values can fall; losses are possible","Portfolio reference exposures may be unavailable in some account wrappers","FX changes affect investors whose base currency is not USD","Fees and imperfect execution can affect realised weights"]},
 seedDefinition:{name:"Golden Butterfly — US reference",family:"FIXED_ALLOCATION",description:"Golden Butterfly — US reference; source-defined exposures and frozen Wealtharr rebalancing convention",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/golden-butterfly.md",goldenTests:"tests/strategy-golden-golden-butterfly.test.ts",releaseStatus:"COMPLETE"
};
