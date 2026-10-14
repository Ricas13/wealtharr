import type {StrategyPlugin} from "./plugin";
import {q4Config} from "./group4-configs";
export const plugin:StrategyPlugin={
 key:"paa",
 profile:{key:"paa",name:"Protective Asset Allocation PAA-12 a=2",engine:"TACTICAL_ALLOCATION",
 launchState:"DRAFT_REQUIRES_VERIFICATION",config:q4Config("paa"),
 rules:"Keller and Keuning 2016 PAA, twelve risky sleeves, SMA12 market breadth with a=2, top six risky, safe intermediate Treasuries.",research:["https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2759734"],
 risks:["Whipsaw and regime changes","Trading, taxes, total-return and provider-calendar mismatch","Execution prices may differ from signal closes"]},
 seedDefinition:{name:"Protective Asset Allocation PAA-12 a=2",family:"TACTICAL",description:"Keller and Keuning 2016 PAA, twelve risky sleeves, SMA12 market breadth with a=2, top six risky, safe intermediate Treasuries.",
 engine:"TACTICAL_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],
 initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/paa.md",
 goldenTests:"tests/paa-golden.test.ts"
};
