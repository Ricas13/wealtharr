import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"buffett-90-10",
  profile:{
    key:"buffett-90-10",name:"Buffett 90/10 Portfolio",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_LARGE_CAP","0.90"],["SHORT_TREASURY","0.10"]],"ANNUAL"),
    rules:"90% low-cost S&P 500 exposure and 10% short-term US government bonds. Annual rebalance is this model's convention, not a Buffett-mandated schedule.",
    research:["https://www.berkshirehathaway.com/letters/2013ltr.pdf"],risks:["US-equity concentration","Bond maturity and regional instrument fidelity"]
  },
  seedDefinition:{
    name:"Buffett 90/10 Portfolio",family:"FIXED_ALLOCATION",description:"Fixed 90/10 reference model",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/buffett-90-10.md",
  goldenTests:"tests/strategy-reference-golden.test.ts"
};
