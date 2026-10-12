import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"dual-momentum",
  profile:{
    key:"dual-momentum",name:"Global Dual Momentum",engine:"MOMENTUM_ROTATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Compare specified equity assets over a versioned 12-month lookback; select the relative winner only if its absolute return exceeds the explicitly configured defensive hurdle, otherwise hold defensive assets. Review monthly. Exact universes, signals, lookback, end-of-month convention and defensive asset MUST be explicit.",
    research:["https://www.optimalmomentum.com/global-equities-momentum/"],risks:["Whipsaws","Look-ahead bias","Missing historical data must block trades"]
  },
  seedDefinition:{
    name:"Dual Momentum",family:"MOMENTUM",description:"Momentum rotation strategy",
    engine:"MOMENTUM_ROTATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:null,realignsResearchOnlyDefinition:false
  },
  specCard:null,
  goldenTests:null
};
