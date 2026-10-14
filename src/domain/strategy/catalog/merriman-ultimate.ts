import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/**
 * Explicit 2026 UB&H 50% US / 50% international, all-equity, ten-sleeve model.
 * Each tenth is a distinct factor/geographic sleeve. This is NOT the separate 70/30 version,
 * and no bond allocation is silently inferred. Annual review/zero tolerance are Wealtharr
 * operating conventions, not a quote from Merriman's research.
 */
export const plugin:StrategyPlugin={
  key:"merriman-ultimate",
  profile:{
    key:"merriman-ultimate",
    name:"Merriman Ultimate Buy-and-Hold (50/50 ten-sleeve equity)",
    engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([
      ["US_LARGE_CAP","0.10"],
      ["US_LARGE_CAP_VALUE","0.10"],
      ["US_SMALL_CAP_BLEND","0.10"],
      ["US_SMALL_CAP_VALUE","0.10"],
      ["US_REITS","0.10"],
      ["DEVELOPED_EX_US_LARGE_CAP","0.10"],
      ["DEVELOPED_EX_US_LARGE_CAP_VALUE","0.10"],
      ["DEVELOPED_EX_US_SMALL_CAP_BLEND","0.10"],
      ["DEVELOPED_EX_US_SMALL_CAP_VALUE","0.10"],
      ["EMERGING_MARKETS_EQUITY","0.10"]
    ],"ANNUAL"),
    rules:"2026 Foundation 50/50 US/international ten-sleeve equity variant: five US equity sleeves and five international equity sleeves, 10% each. Annual calendar review with a zero-drift threshold is a Wealtharr operational convention. This is a 100% equity strategy; no bonds are implied. Distinguish the Foundation's 70/30 version and all stock/bond mixes.",
    research:["https://www.paulmerriman.com/ultimate-buy-and-hold-2026","https://www.paulmerriman.com/data-tables"],
    risks:["All-equity drawdowns","Factor tracking error and prolonged value/small-cap underperformance","Exact international small and value sleeve coverage","Ten funds magnify fees and small-order friction","Broker and tax-wrapper restrictions"]
  },
  seedDefinition:{
    name:"Merriman Ultimate Buy-and-Hold (50/50)",family:"FIXED_ALLOCATION",
    description:"Ten-sleeve 100% equity 50/50 US/international allocation; annual Wealtharr review convention",
    engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],initialVersion:"DRAFT",
    realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/group-2-merriman-ultimate.md",
  goldenTests:"tests/strategy-group-2-golden.test.ts"
};
