import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"gtaa-ivy",
  profile:{
    key:"gtaa-ivy",name:"GTAA / Ivy",engine:"MOMENTUM_ROTATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Define the exact Faber-style 10-month moving-average timing universe and cash rules, then evaluate monthly. Variants are separate immutable strategy versions.",
    research:["https://mebfaber.com/2007/06/"],
    risks:["Return series and dividend adjustments","No universal GTAA specification"]
  },
  seedDefinition:{
    name:"GTAA / Ivy",family:"MOMENTUM",description:"Research pending",
    engine:"MOMENTUM_ROTATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:null,realignsResearchOnlyDefinition:false
  },
  specCard:null,
  goldenTests:null
};
