import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"coffeehouse",
  profile:{
    key:"coffeehouse",name:"Coffeehouse Portfolio — US seven-fund reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_LARGE_CAP","0.10"],["US_LARGE_CAP_VALUE","0.10"],["US_SMALL_CAP_BLEND","0.10"],
      ["US_SMALL_CAP_VALUE","0.10"],["DEVELOPED_EX_US_LARGE_CAP","0.10"],
      ["US_INTERMEDIATE_TREASURY","0.40"],["US_REITS","0.10"]],"ANNUAL"),
    rules:"Bill Schultheis seven-fund US reference: 10% each in large blend/value, small blend/value, developed ex-US and US REITs, plus 40% US intermediate Treasuries. Annual review is an explicit platform convention, not an author-mandated universal rule.",
    research:["https://portfoliocharts.com/portfolios/coffeehouse-portfolio/"],
    risks:["UK fund equivalence and value-factor fidelity","US REIT tax/availability","Intermediate Treasury duration"]
  },
  seedDefinition:{
    name:"Coffeehouse Portfolio — US seven-fund reference",family:"FIXED_ALLOCATION",description:"Research-only seven-asset profile",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:true
  },
  specCard:"docs/strategy-specs/group-2-coffeehouse.md",
  goldenTests:"tests/strategy-group-2-golden.test.ts"
};
