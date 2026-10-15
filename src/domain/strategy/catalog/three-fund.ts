import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/** Frozen US-reference economic method; account-specific listings remain gated by EXACT mappings. */
export const plugin:StrategyPlugin={
 key:"three-fund",
 profile:{key:"three-fund",name:"Three-Fund — US 40/40/20 model",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
  config:fixed([["G1_US_TOTAL_EQUITY","0.40"],["G1_EX_US_TOTAL_EQUITY","0.40"],["G1_US_AGGREGATE_BONDS","0.20"]],"ANNUAL"),
  rules:"Bogleheads specifies the three underlying asset classes, not universal weights. The 40/40/20 weights are Wealtharr's frozen US-reference variant. Method: annually rebalance to fixed weights with zero drift threshold on review; add available strategy cash to the portfolio before evaluating target weights. Fees, broker lot sizes and cash residue use the shared execution engine.",
  research:["https://www.bogleheads.org/wiki/Three-fund_portfolio"],
  risks:["Market values can fall; losses are possible","Portfolio reference exposures may be unavailable in some account wrappers","FX changes affect investors whose base currency is not USD","Fees and imperfect execution can affect realised weights"]},
 seedDefinition:{name:"Three-Fund — US 40/40/20 model",family:"FIXED_ALLOCATION",description:"Three-Fund — US 40/40/20 model; source-defined exposures and frozen Wealtharr rebalancing convention",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/three-fund.md",goldenTests:"tests/strategy-golden-three-fund.test.ts",releaseStatus:"COMPLETE"
};
