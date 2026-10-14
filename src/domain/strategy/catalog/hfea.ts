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
      // Official NYSE/ICE trading closures, 2026–28 (not US bank holidays).
      // Refresh from the NYSE annual calendar before 2029, including special closures.
      marketHolidays:["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25","2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24","2028-01-17","2028-02-21","2028-04-14","2028-05-29","2028-06-19","2028-07-04","2028-09-04","2028-11-23","2028-12-25"]
    },
    rules:"Target 55% 3x S&P 500 (UPRO) and 45% 3x long-duration US Treasuries (TMF); rebalance on quarter reviews. TQQQ is NOT the original HFEA stock leg.",
    research:["https://www.bogleheads.org/forum/viewtopic.php?t=272007","https://www.nyse.com/trade/hours-calendars","https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/"],
    risks:["Daily leverage resets and path dependency","Bonds and equities can fall together","UK ISA/UCITS substitutions must not be assumed equivalent"]
  },
  seedDefinition:{
    name:"HFEA",family:"FIXED_ALLOCATION",description:"Leveraged fixed-allocation strategy",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/group-2-hfea.md",
  goldenTests:"tests/strategy-group-2-golden.test.ts",
releaseStatus:"COMPLETE"
};
