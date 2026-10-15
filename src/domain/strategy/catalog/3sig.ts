import type {StrategyPlugin} from "./plugin";

export const plugin:StrategyPlugin={
  key:"3sig",
  profile:{
    key:"3sig",name:"Small-Cap Quarterly Target (research pending)",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Do not infer 3sig parameters by renaming the 9Sig engine. Verify the source book's target growth, signal frequency, bands, cash management and reset rules before publication.",
    research:["https://jasonkelly.com/2017/01/how-my-signal-system-works/","https://jasonkelly.com/books/3sig/","https://jasonkelly.com/"], risks:["Proprietary method ambiguity","Version-specific interpretation"]
  },
  seedDefinition:null,
  specCard:null,
  goldenTests:null
};
