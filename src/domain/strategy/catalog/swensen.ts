import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"swensen",
  profile:{
    key:"swensen",name:"Swensen Lazy Portfolio — six-asset US reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_TOTAL_EQUITY","0.30"],["DEVELOPED_EX_US_LARGE_CAP","0.15"],
      ["EMERGING_MARKETS_EQUITY","0.05"],["US_REITS","0.20"],
      ["US_INTERMEDIATE_TREASURY","0.15"],["US_TIPS","0.15"]],"ANNUAL"),
    rules:"David Swensen's individual-investor six-asset reference: 30% US equity, 15% developed foreign, 5% emerging, 20% US REITs, 15% US Treasuries and 15% US TIPS. This is not Yale endowment allocation; exact Treasury-duration implementation must be independently approved.",
    research:["https://www.bogleheads.org/blog/2021/01/02/david-swensens-portfolio-from-unconventional-success-2020-update/"],
    risks:["Interest-rate and inflation-linked Treasury risk","Emerging markets","US REIT and UK wrapper availability"]
  },
  seedDefinition:{
    name:"Swensen Lazy Portfolio — US reference",family:"FIXED_ALLOCATION",description:"Research-only six-asset profile",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:true
  },
  specCard:"docs/strategy-specs/coffeehouse-core-four-swensen.md",
  goldenTests:"tests/strategy-reference-golden.test.ts"
};
