import type {StrategyPlugin} from "./plugin";
import {q4Config} from "./group4-configs";
export const plugin:StrategyPlugin={
 key:"dual-momentum",
 profile:{key:"dual-momentum",name:"Global Equities Momentum (GEM)",engine:"TACTICAL_ALLOCATION",
 launchState:"DRAFT_REQUIRES_VERIFICATION",config:q4Config("dual-momentum"),
 rules:"S&P 500 vs MSCI ACWI ex US twelve-month relative momentum; compare S&P 500 return to three-month Treasury bill total return; US Aggregate defensive allocation.",research:["https://www.optimalmomentum.com/global-equities-momentum/"],
 risks:["Whipsaw and regime changes","Trading, taxes, total-return and provider-calendar mismatch","Execution prices may differ from signal closes"]},
 seedDefinition:{name:"Global Equities Momentum (GEM)",family:"TACTICAL",description:"S&P 500 vs MSCI ACWI ex US twelve-month relative momentum; compare S&P 500 return to three-month Treasury bill total return; US Aggregate defensive allocation.",
 engine:"TACTICAL_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],
 initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/dual-momentum.md",
 goldenTests:"tests/dual-momentum-golden.test.ts",
 releaseStatus:"COMPLETE"
};
