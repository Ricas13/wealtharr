import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"trinity",
  profile:{
    key:"trinity",name:"Trinity Portfolio (Meb Faber)",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"A named Trinity Portfolio version must specify allocation, momentum timing and cash rules; do not blend static and tactical implementations.",
    research:["https://mebfaber.com/"],risks:["Timing implementation differences","Model data/licensing requirements"]
  },
  seedDefinition:null,
  specCard:null,
  goldenTests:null
};
