import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"trend-200d",
  profile:{
    key:"trend-200d",name:"200-Day Moving Average Trend",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"A versioned 200-day closing-price trend-following method; universe, signal-day convention, defensive asset, and adjusted-price policy must be fixed and verified.",
    research:["https://mebfaber.com/"],risks:["Whipsaw","Corporate actions and trading calendars","False signals on unadjusted quotes"]
  },
  seedDefinition:null,
  specCard:null,
  goldenTests:null
};
