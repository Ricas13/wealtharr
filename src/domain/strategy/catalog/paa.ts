import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"paa",
  profile:{
    key:"paa",name:"Protective Asset Allocation",engine:"MOMENTUM_ROTATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Requires exact published PAA risk and protection universes, momentum metrics, breadth rules and protection allocation; not safely represented by generic relative momentum.",
    research:["https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2759734"],risks:["Complex regime/breadth calculations"]
  },
  seedDefinition:{
    name:"Protective Asset Allocation",family:"MOMENTUM",description:"Research pending",
    engine:"MOMENTUM_ROTATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:null,realignsResearchOnlyDefinition:false
  },
  specCard:null,
  goldenTests:null
};
