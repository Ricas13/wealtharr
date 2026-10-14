import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/** 2014 Reducing the Risk of Black Swans 28/72 example, NOT Portfolio Charts' rounded 30/70. */
export const plugin:StrategyPlugin={
  key:"larry-portfolio",
  profile:{
    key:"larry-portfolio",name:"Larry Portfolio — 2014 28/72 example",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_SMALL_CAP_VALUE","0.14"],["DEVELOPED_EX_US_SMALL_CAP_VALUE","0.105"],["EMERGING_MARKETS_VALUE","0.035"],["US_FIVE_YEAR_TREASURY","0.72"]],"ANNUAL"),
    rules:"Fixed example from Reducing the Risk of Black Swans: 14% US small value, 10.5% non-US developed small value, 3.5% emerging-market value, 72% 5-year US Treasuries. The annual exact-weight rebalance is a Wealtharr convention. Do not substitute broad emerging equities for emerging value.",
    research:["https://www.bogleheads.org/forum/viewtopic.php?t=169285","https://portfoliocharts.com/portfolios/larry-portfolio/"],
    risks:["Concentrated factor risk","Emerging-markets value fund availability","Five-year Treasury maturity and currency exposure"]
  },
  seedDefinition:null,specCard:"docs/strategy-specs/larry-portfolio.md",goldenTests:"tests/group-3-reference.test.ts"
};
