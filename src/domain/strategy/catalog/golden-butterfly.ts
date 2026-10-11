import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"golden-butterfly",
  profile:{
    key:"golden-butterfly",name:"Golden Butterfly",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_LARGE_CAP","0.20"],["US_SMALL_CAP_VALUE","0.20"],["LONG_TREASURY","0.20"],["SHORT_TREASURY","0.20"],["GOLD","0.20"]],"ANNUAL"),
    rules:"Five 20% sleeves: large-cap stocks, small-cap value stocks, long Treasuries, short Treasuries, gold. Annual review/rebalance is a configurable profile, not a claim about the only canonical schedule.",
    research:["https://portfoliocharts.com/portfolios/golden-butterfly-portfolio/"],
    risks:["US factor/instrument mapping varies by jurisdiction","Gold implementation and fees vary"]
  },
  seedDefinition:{
    name:"Golden Butterfly",family:"FIXED_ALLOCATION",description:"Diversified fixed-allocation strategy",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/golden-butterfly.md",
  goldenTests:"tests/strategy-reference-golden.test.ts"
};
