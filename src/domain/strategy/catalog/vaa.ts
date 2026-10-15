import type {StrategyPlugin} from "./plugin";
import {q4Config} from "./group4-configs";
export const plugin:StrategyPlugin={
 key:"vaa",
 profile:{key:"vaa",name:"Vigilant Asset Allocation G4",engine:"TACTICAL_ALLOCATION",
 launchState:"DRAFT_REQUIRES_VERIFICATION",config:q4Config("vaa"),
 rules:"Keller and Keuning VAA-G4: four offensive assets, top one, breadth one, weighted 1/3/6/12 momentum, highest-scoring protective Treasury/corporate bond.",research:["https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3002624"],
 risks:["Whipsaw and regime changes","Trading, taxes, total-return and provider-calendar mismatch","Execution prices may differ from signal closes"]},
 seedDefinition:{name:"Vigilant Asset Allocation G4",family:"TACTICAL",description:"Keller and Keuning VAA-G4: four offensive assets, top one, breadth one, weighted 1/3/6/12 momentum, highest-scoring protective Treasury/corporate bond.",
 engine:"TACTICAL_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],
 initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/vaa.md",
 goldenTests:"tests/vaa-golden.test.ts",
 releaseStatus:"COMPLETE"
};
