import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"three-fund",
  profile:{
    key:"three-fund",name:"Three-Fund Portfolio — 40/40/20 model",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["DOMESTIC_EQUITY","0.40"],["INTERNATIONAL_EQUITY","0.40"],["AGGREGATE_BONDS","0.20"]],"ANNUAL"),
    rules:"A fixed 40/40/20 three-fund reference model; this is not a universal Bogleheads allocation. Other splits require separate named versions.",
    research:["https://www.bogleheads.org/wiki/Three-fund_portfolio"],risks:["Home bias","Bond duration and currency"]
  },
  seedDefinition:{
    name:"Three-Fund Portfolio — 40/40/20 model",family:"FIXED_ALLOCATION",description:"Named fixed-allocation strategy",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/three-fund.md",
  goldenTests:null
};
