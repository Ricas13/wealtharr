import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"two-funds-for-life",
  profile:{
    key:"two-funds-for-life",name:"Two Funds for Life (Paul Merriman)",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Merriman's two-fund lifetime allocation between S&P 500 and small-cap value; age adjustments, instrument rules and rebalancing need source-specific testing.",
    research:["https://www.paulmerriman.com/"],risks:["Style and size tilt","Fund universe and tax wrapper restrictions"]
  },
  seedDefinition:null,
  specCard:null,
  goldenTests:null
};
