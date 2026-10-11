import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"80-20",
  profile:{
    key:"80-20",name:"80/20 Portfolio",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["BROAD_EQUITY","0.80"],["AGGREGATE_BONDS","0.20"]],"ANNUAL"),
    rules:"80% diversified equities and 20% bonds; review annually.",
    research:["https://www.bogleheads.org/wiki/Asset_allocation"],risks:["High equity drawdown potential"]
  },
  seedDefinition:{
    name:"80/20 Portfolio",family:"FIXED_ALLOCATION",description:"Named fixed-allocation strategy",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/80-20.md",
  goldenTests:null
};
