import type {StrategyPlugin} from "./plugin";
import {q4Config} from "./group4-configs";
export const plugin:StrategyPlugin={
 key:"gtaa-ivy",
 profile:{key:"gtaa-ivy",name:"Global Tactical Asset Allocation / Ivy 5",engine:"TACTICAL_ALLOCATION",
 launchState:"DRAFT_REQUIRES_VERIFICATION",config:q4Config("gtaa-ivy"),
 rules:"Five equal 20-percent benchmark slices, each above its last ten completed month-end closes' arithmetic moving average or allocated to T-bills.",research:["https://mebfaber.com/timing-model/"],
 risks:["Whipsaw and regime changes","Trading, taxes, total-return and provider-calendar mismatch","Execution prices may differ from signal closes"]},
 seedDefinition:{name:"Global Tactical Asset Allocation / Ivy 5",family:"TACTICAL",description:"Five equal 20-percent benchmark slices, each above its last ten completed month-end closes' arithmetic moving average or allocated to T-bills.",
 engine:"TACTICAL_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],
 initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/gtaa-ivy.md",
 goldenTests:"tests/gtaa-ivy-golden.test.ts",
 releaseStatus:"COMPLETE"
};
