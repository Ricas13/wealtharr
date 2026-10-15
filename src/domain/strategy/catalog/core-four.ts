import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

export const plugin:StrategyPlugin={
  key:"core-four",
  profile:{
    key:"core-four",name:"Four-Fund Stocks/Bonds/REIT Reference (Core Four research)",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_TOTAL_EQUITY","0.48"],["TOTAL_EX_US_EQUITY","0.24"],
      ["US_AGGREGATE_BONDS","0.20"],["US_REITS","0.08"]],"ANNUAL"),
    rules:"An explicit 80/20 four-fund research split based on the asset classes on Rick Ferri's official Classic Core-4 website: 48% total US stocks, 24% total international equities, 20% US investment-grade aggregate bonds and 8% US REITs. Not an officially endorsed or licensed product; the 80/20 allocation is one separate version.",
    research:["https://core-4.com/classic-core-4-portfolio/","https://core-4.com/classic-core-4-portfolio-allocations/","https://portfoliocharts.com/portfolios/core-four-portfolio/"],
    risks:["Core-4 is a registered trade mark: commercial name/licence clearance required","Bond universe must include credit and MBS rather than only Treasuries","UK fund eligibility, currencies and REIT coverage"]
  },
  seedDefinition:{
    name:"Four-Fund Stocks/Bonds/REIT Reference",family:"FIXED_ALLOCATION",description:"Research-only four-asset profile; source name requires brand licensing",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:true
  },
  specCard:"docs/strategy-specs/group-2-core-four.md",
  goldenTests:"tests/strategy-group-2-golden.test.ts",
releaseStatus:"COMPLETE"
};
