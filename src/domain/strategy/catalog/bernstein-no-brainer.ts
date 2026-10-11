import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"bernstein-no-brainer",
  profile:{
    key:"bernstein-no-brainer",name:"Bernstein No-Brainer Portfolio",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"William Bernstein inspired diversified US and international stock sleeves and short government bonds; verify published weights and dates before release.",
    research:["https://www.bogleheads.org/wiki/Lazy_portfolios"],risks:["Equity risk","Regional duration, currency and instrument fidelity"]
  },
  seedDefinition:null,
  specCard:null,
  goldenTests:null
};
