import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/**
 * A named Wealtharr model, not one author's strategy. The Bogleheads asset-allocation wiki names
 * the 60/40 stock/bond split as a common allocation; the global all-cap/aggregate-bond exposure
 * definitions, the GBP hedge on the bond leg, the annual review and the zero threshold are Wealtharr
 * model conventions that the owner must confirm (docs/strategy-specs/60-40.md).
 */
export const plugin:StrategyPlugin={
  key:"60-40",
  profile:{
    key:"60-40",name:"Global 60/40 (GBP) model",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["GLOBAL_EQUITY_ALL_CAP_UNHEDGED","0.60"],["GLOBAL_AGGREGATE_BONDS_GBP_HEDGED","0.40"]],"ANNUAL"),
    rules:"Wealtharr model: 60% global all-capitalisation equities (unhedged) and 40% global investment-grade aggregate bonds (hedged to sterling), reviewed once a year. At each review the portfolio is rebalanced back to 60/40 whatever the drift (rebalance threshold 0). Cash added to the strategy is used to buy the underweight leg before anything is sold. The 60/40 split is the commonly cited weighting; the annual review, the zero threshold and the exact exposure definitions are Wealtharr model conventions, not rules of a single author. Other splits, thresholds or schedules are separate named models.",
    research:["https://www.bogleheads.org/wiki/Asset_allocation"],
    risks:[
      "Stock and bond prices can fall together; stock-bond correlations can change",
      "Between annual reviews the portfolio can drift well away from 60/40",
      "The equity leg is unhedged and the bond leg is sterling-hedged: currency moves and hedging costs affect returns",
      "Fund fees, tracking differences and availability depend on the listed products verified for your account type"
    ]
  },
  seedDefinition:{
    name:"Global 60/40 (GBP) model",family:"FIXED_ALLOCATION",
    description:"Wealtharr model: 60% global equity, 40% global aggregate bonds, annual rebalance",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"DRAFT",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/60-40.md",
  goldenTests:"tests/strategy-reference-golden.test.ts"
};
