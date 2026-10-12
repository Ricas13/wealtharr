import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"vaa",
  profile:{
    key:"vaa",name:"Vigilant Asset Allocation",engine:"MOMENTUM_ROTATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Requires exact VAA offensive/defensive universes and multi-horizon momentum scoring; distinct from PAA.",
    research:["https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3002624"],risks:["Whipsaw","Trading-calendar precision"]
  },
  seedDefinition:{
    name:"Vigilant Asset Allocation",family:"MOMENTUM",description:"Research pending",
    engine:"MOMENTUM_ROTATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:null,realignsResearchOnlyDefinition:false
  },
  specCard:null,
  goldenTests:null
};
