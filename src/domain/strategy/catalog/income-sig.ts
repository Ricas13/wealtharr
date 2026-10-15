import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"income-sig",
  profile:{
    key:"income-sig",name:"Wealtharr Income & Reserve Model",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Official quarterly Income Sig leveraged allocation and surplus-skimming methodology; exact weights, reserve management and all reset rules must be verified from the author's materials.",
    research:["https://jasonkelly.com/"],risks:["Daily-reset leverage","Proprietary licensed rules","High downside risk"]
  },
  seedDefinition:null,
  specCard:null,
  goldenTests:null
};
