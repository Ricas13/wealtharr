import type {StrategyPlugin} from "./plugin";
import {q4Config} from "./group4-configs";
export const plugin:StrategyPlugin={
 key:"risk-parity",
 profile:{key:"risk-parity",name:"Equal Risk Contribution (252 sessions)",engine:"TACTICAL_ALLOCATION",
 launchState:"DRAFT_REQUIRES_VERIFICATION",config:q4Config("risk-parity"),
 rules:"Four long-only sleeves with equal covariance risk contributions from a 252-complete-session sample covariance estimate; monthly reset, no leverage.",research:["https://www.thierry-roncalli.com/download/erc.pdf"],
 risks:["Whipsaw and regime changes","Trading, taxes, total-return and provider-calendar mismatch","Execution prices may differ from signal closes"]},
 seedDefinition:{name:"Equal Risk Contribution (252 sessions)",family:"TACTICAL",description:"Four long-only sleeves with equal covariance risk contributions from a 252-complete-session sample covariance estimate; monthly reset, no leverage.",
 engine:"TACTICAL_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],
 initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/risk-parity.md",
 goldenTests:"tests/risk-parity-golden.test.ts"
};
