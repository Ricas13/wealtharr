import type {StrategyPlugin} from "./plugin";
import {TRINITY_CONFIG} from "../trinity-model";

/** Tactfolio 2016 Faber Trinity proxy, not the proprietary Cambria product. */
export const plugin:StrategyPlugin={
  key:"trinity",
  profile:{
    key:"trinity",name:"Trinity Portfolio — Faber 2016 Tactfolio proxy",
    engine:"TRINITY_HYBRID",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:{...TRINITY_CONFIG},
    rules:"Named independently reproducible Tactfolio 2016 Faber Trinity proxy: 50% monthly rebalanced Global Asset Allocation static weights with US value and momentum tilts; 50% Global Trend scoring ten assets using mean 1/3/6/12-month adjusted total returns, ranking top five, buying each only while above its 10-month month-end moving average and diverting failed slots to Treasury bills. US stock signal is broad large-cap, but the actual target splits half US large value and half US momentum. Signals require 13 fully verified month-end observations and cannot trade from missing/future history. This is not Faber/Cambria's proprietary fund selection.",
    research:["https://mebfaber.com/2016/08/19/episode-15-trinity-portfolio/",
      "https://tactfolio.com/strategies/trinity-portfolio"],
    risks:["Momentum whipsaws and delayed month-end signals","Foreign-currency and ETF factor mismatches","Verified corporate-action adjusted series across 10 assets required"]
  },
  seedDefinition:{name:"Trinity Portfolio — Faber 2016 Tactfolio proxy",
    family:"TACTICAL_MULTI_ASSET",
    description:"50% global buy-and-hold and 50% monthly ranked, trend-filtered Global Trend proxy",
    engine:"TRINITY_HYBRID",proprietary:false,enabled:false,supportedRegions:[],
    supportedWrappers:[],initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:true},
  specCard:"docs/strategy-specs/trinity.md",
  goldenTests:"tests/trinity-hybrid-engine.test.ts",
  releaseStatus:"COMPLETE"
};
