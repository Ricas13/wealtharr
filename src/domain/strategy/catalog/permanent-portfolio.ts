import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"permanent-portfolio",
  profile:{
    key:"permanent-portfolio",name:"Permanent Portfolio",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["BROAD_EQUITY","0.25"],["LONG_TREASURY","0.25"],["CASH_BILLS","0.25"],["GOLD","0.25"]],"ANNUAL"),
    rules:"Harry Browne style equal quarters in stocks, long government bonds, cash or T-bills, and gold. Threshold bands are variants and require explicit versioning.",
    research:["https://portfoliocharts.com/portfolios/permanent-portfolio/"],
    risks:["Interest-rate/inflation exposure","Cash sleeve and home-currency choices matter"]
  },
  seedDefinition:{
    name:"Permanent Portfolio",family:"FIXED_ALLOCATION",description:"Four equal asset sleeves",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/permanent-portfolio.md",
  goldenTests:"tests/strategy-reference-golden.test.ts"
};
