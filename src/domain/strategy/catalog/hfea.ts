import type {StrategyPlugin} from "./plugin";
import {fixed,LEVERAGE_DISCLOSURE} from "./plugin";

export const plugin:StrategyPlugin={
  key:"hfea",
  profile:{
    key:"hfea",name:"Hedgefundie Excellent Adventure (classic)",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",disclosure:LEVERAGE_DISCLOSURE,
    config:{
      ...fixed([["US_EQUITY_3X_LONG","0.55"],["LONG_TREASURY_3X_LONG","0.45"]],"QUARTERLY"),
      reviewSchedule:"CALENDAR_QUARTER_END",
      reviewTimezone:"America/New_York",
      reviewCutoffLocal:"16:00",
      marketHolidays:[]
    },
    rules:"Target 55% 3x S&P 500 (UPRO) and 45% 3x long-duration US Treasuries (TMF); rebalance on quarter reviews. TQQQ is NOT the original HFEA stock leg.",
    research:["https://www.reddit.com/r/LETFs/comments/r25c3n/","https://www.reddit.com/r/LETFs/comments/pkkoao/"],
    risks:["Daily leverage resets and path dependency","Bonds and equities can fall together","UK ISA/UCITS substitutions must not be assumed equivalent"]
  },
  seedDefinition:{
    name:"HFEA",family:"FIXED_ALLOCATION",description:"Leveraged fixed-allocation strategy",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/hfea.md",
  goldenTests:"tests/strategy-reference-golden.test.ts"
};
