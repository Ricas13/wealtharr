import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"80-20",
  profile:{
    key:"80-20",name:"Global 80/20 (GBP) model",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["GLOBAL_EQUITY_ALL_CAP_UNHEDGED","0.80"],["GLOBAL_AGGREGATE_BONDS_GBP_HEDGED","0.20"]],"ANNUAL"),
    rules:"Wealtharr model: 80% global all-capitalisation equity unhedged and 20% global investment-grade aggregate bonds GBP hedged. Review annually and rebalance back to 80/20 with zero drift threshold. Weight, specific exposures and zero threshold are Wealtharr conventions, not universal Bogleheads rules.",
    research:["https://www.bogleheads.org/wiki/Asset_allocation","https://investor.vanguard.com/investor-resources-education/portfolio-management/rebalancing-your-portfolio"],risks:["High equity drawdown potential"]
  },
  seedDefinition:{
    name:"Global 80/20 (GBP) model",family:"FIXED_ALLOCATION",description:"Named fixed-allocation strategy",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/80-20.md",
  goldenTests:"tests/strategy-golden-80-20.test.ts",
  releaseStatus:"COMPLETE"
};
