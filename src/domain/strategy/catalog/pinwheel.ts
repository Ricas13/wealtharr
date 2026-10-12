import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"pinwheel",
  profile:{
    key:"pinwheel",name:"Pinwheel Portfolio",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Portfolio Charts Pinwheel multi-asset reference; verify the entire original asset allocation and international fund translation.",
    research:["https://portfoliocharts.com/portfolios/"],risks:["Multi-asset rebalancing and tax","Home-country exposure mapping"]
  },
  seedDefinition:null,
  specCard:null,
  goldenTests:null
};
