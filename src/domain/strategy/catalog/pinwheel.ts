import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/** Tyler's original 2018 article, US-home eight-sleeve specification. */
export const plugin:StrategyPlugin={
  key:"pinwheel",
  profile:{
    key:"pinwheel",name:"Pinwheel — 2018 US reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["G3_US_LARGE_CAP_BLEND","0.15"],["G3_US_SMALL_CAP_VALUE","0.10"],["G3_DEV_EX_US_LARGE_CAP_BLEND","0.15"],["G3_EM_LARGE_CAP_BLEND","0.10"],["G3_US_INTERMEDIATE_TREASURY","0.15"],["G3_US_TREASURY_BILLS","0.10"],["G3_US_REITS","0.15"],["G3_PHYSICAL_GOLD","0.10"]],"ANNUAL"),
    rules:"Tyler's original 2018 US-home allocation: 15% US large-cap blend, 10% domestic small value, 15% developed ex-US large-cap blend, 10% emerging markets, 15% intermediate domestic government bonds, 10% domestic Treasury bills, 15% REITs, 10% gold. Annual exact-target review is Wealtharr policy, not an author claim.",
    research:["https://portfoliocharts.com/portfolios/pinwheel-portfolio/"],
    risks:["International sleeve must not silently double-count emerging allocation","REIT and commodity mapping","Bill maturity and cash sweep"]
  },
  seedDefinition:null,specCard:"docs/strategy-specs/pinwheel.md",goldenTests:"tests/group-3-reference.test.ts"
};
