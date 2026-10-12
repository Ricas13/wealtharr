import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"larry-portfolio",
  profile:{
    key:"larry-portfolio",name:"Larry Portfolio",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Larry Swedroe's factor-oriented equity and fixed-income model; multiple named historical variants require strict identification.",
    research:["https://portfoliocharts.com/portfolios/"],risks:["Small/value factor implementation","Duration exposure","Fidelity of available ETFs"]
  },
  seedDefinition:null,
  specCard:null,
  goldenTests:null
};
