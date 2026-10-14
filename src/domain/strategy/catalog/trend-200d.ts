import type {StrategyPlugin} from "./plugin";
import {q4Config} from "./group4-configs";
export const plugin:StrategyPlugin={
 key:"trend-200d",
 profile:{key:"trend-200d",name:"200-Day Moving Average Trend",engine:"TACTICAL_ALLOCATION",
 launchState:"DRAFT_REQUIRES_VERIFICATION",config:q4Config("trend-200d"),
 rules:"US S&P 500 versus three-month Treasury bill total-return exposure; compare last completed monthly signal session with exactly 200 completed daily closes and rotate next eligible session.",research:["https://mebfaber.com/timing-model/"],
 risks:["Whipsaw and regime changes","Trading, taxes, total-return and provider-calendar mismatch","Execution prices may differ from signal closes"]},
 seedDefinition:{name:"200-Day Moving Average Trend",family:"TACTICAL",description:"US S&P 500 versus three-month Treasury bill total-return exposure; compare last completed monthly signal session with exactly 200 completed daily closes and rotate next eligible session.",
 engine:"TACTICAL_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],
 initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/trend-200d.md",
 goldenTests:"tests/trend-200d-golden.test.ts"
};
