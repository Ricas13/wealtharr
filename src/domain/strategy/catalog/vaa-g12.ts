import type {StrategyPlugin} from "./plugin";
import {q4Config} from "./group4-configs";
export const plugin:StrategyPlugin={
 key:"vaa-g12",
 profile:{key:"vaa-g12",name:"Vigilant Asset Allocation G12",engine:"TACTICAL_ALLOCATION",
 launchState:"DRAFT_REQUIRES_VERIFICATION",config:q4Config("vaa-g12"),
 rules:"Keller/Keuning Global 12: 12 offensive exposures, top two equal weight, breadth four, Easy Trading floor rounding, 1/3/6/12 weighted momentum, top-ranked defensive exposure when breadth deteriorates.",
 research:["https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3002624"],
 risks:["Whipsaw","Overlapping LQD offensive and defensive exposure must be netted","History and execution calendar mismatch"]},
 seedDefinition:{name:"Vigilant Asset Allocation G12",family:"TACTICAL",
 description:"VAA G12 12-offensive five-holding breadth protection",
 engine:"TACTICAL_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],
 initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false},
 specCard:"docs/strategy-specs/vaa-g12.md",goldenTests:"tests/vaa-g12-golden.test.ts"
};
