import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"risk-parity",
  profile:{
    key:"risk-parity",name:"Risk Parity (rules-based reference)",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Risk-parity is a method family rather than one fixed allocation: publish a specific public methodology with lookback windows, covariance settings and rebalance rules.",
    research:["https://portfoliocharts.com/portfolios/"],risks:["Leverage and covariance instability","Ambiguous reference implementation"]
  },
  seedDefinition:null,
  specCard:null,
  goldenTests:null
};
