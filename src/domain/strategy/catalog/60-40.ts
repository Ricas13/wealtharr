import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"60-40",
  profile:{
    key:"60-40",name:"60/40 Portfolio",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["BROAD_EQUITY","0.60"],["AGGREGATE_BONDS","0.40"]],"ANNUAL"),
    rules:"Fixed 60% diversified equities and 40% bonds; annual calendar review. Alternative rebalancing thresholds are separately versioned models.",
    research:["https://www.bogleheads.org/wiki/Asset_allocation"],risks:["Stock-bond correlations can change"]
  },
  seedDefinition:{
    name:"60/40 Portfolio",family:"FIXED_ALLOCATION",description:"Named fixed-allocation strategy",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/60-40.md",
  goldenTests:"tests/strategy-reference-golden.test.ts"
};
