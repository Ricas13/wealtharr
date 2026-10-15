import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/** Frozen US-reference economic method; account-specific listings remain gated by EXACT mappings. */
export const plugin:StrategyPlugin={
 key:"permanent-portfolio",
 profile:{key:"permanent-portfolio",name:"Permanent Portfolio — US Treasury bills reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
  config:fixed([["G1_US_LARGE_BLEND","0.25"],["G1_US_LONG_TREASURY","0.25"],["G1_US_TREASURY_BILLS","0.25"],["G1_PHYSICAL_GOLD","0.25"]],"ANNUAL"),
  rules:"The cash-like sleeve means US Treasury bills, not unconstrained cash or generic short-term corporate bonds. Wealtharr adopts annual zero-threshold review; this is distinct from threshold-band implementations. Method: annually rebalance to fixed weights with zero drift threshold on review; add available strategy cash to the portfolio before evaluating target weights. Fees, broker lot sizes and cash residue use the shared execution engine.",
  research:["https://portfoliocharts.com/portfolios/permanent-portfolio/"],
  risks:["Market values can fall; losses are possible","Portfolio reference exposures may be unavailable in some account wrappers","FX changes affect investors whose base currency is not USD","Fees and imperfect execution can affect realised weights"]},
 seedDefinition:{name:"Permanent Portfolio — US Treasury bills reference",family:"FIXED_ALLOCATION",description:"Permanent Portfolio — US Treasury bills reference; source-defined exposures and frozen Wealtharr rebalancing convention",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/permanent-portfolio.md",goldenTests:"tests/strategy-golden-permanent-portfolio.test.ts",releaseStatus:"COMPLETE"
};
