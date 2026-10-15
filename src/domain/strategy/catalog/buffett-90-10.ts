import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/** Frozen US-reference economic method; account-specific listings remain gated by EXACT mappings. */
export const plugin:StrategyPlugin={
 key:"buffett-90-10",
 profile:{key:"buffett-90-10",name:"Buffett 90/10 — US reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
  config:fixed([["G1_SP500_INDEX","0.90"],["G1_US_SHORT_GOVERNMENT","0.10"]],"ANNUAL"),
  rules:"The 2013 Berkshire letter specifies 90% very-low-cost S&P 500 index and 10% short-term government bonds for his wife's trustee, but does not prescribe this software's annual/zero-threshold schedule. Method: annually rebalance to fixed weights with zero drift threshold on review; add available strategy cash to the portfolio before evaluating target weights. Fees, broker lot sizes and cash residue use the shared execution engine.",
  research:["https://www.berkshirehathaway.com/letters/2013ltr.pdf"],
  risks:["Market values can fall; losses are possible","Portfolio reference exposures may be unavailable in some account wrappers","FX changes affect investors whose base currency is not USD","Fees and imperfect execution can affect realised weights"]},
 seedDefinition:{name:"Buffett 90/10 — US reference",family:"FIXED_ALLOCATION",description:"Buffett 90/10 — US reference; source-defined exposures and frozen Wealtharr rebalancing convention",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/buffett-90-10.md",goldenTests:"tests/strategy-golden-buffett-90-10.test.ts",releaseStatus:"COMPLETE"
};
