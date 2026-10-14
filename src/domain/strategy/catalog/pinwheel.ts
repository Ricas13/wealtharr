import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/** Tyler's original 2018 article, US-home eight-sleeve specification. */
export const plugin:StrategyPlugin={
  key:"pinwheel",
  profile:{
    key:"pinwheel",name:"Pinwheel — 2018 US reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_TOTAL_EQUITY","0.15"],["US_SMALL_CAP_VALUE","0.10"],["TOTAL_EX_US_EQUITY","0.15"],["EMERGING_MARKETS_EQUITY","0.10"],["US_INTERMEDIATE_TREASURY","0.15"],["US_TREASURY_BILLS","0.10"],["US_REITS","0.15"],["GOLD","0.10"]],"ANNUAL"),
    rules:"Tyler's original 2018 US-home allocation: 15% domestic total stocks, 10% domestic small value, 15% international stocks, 10% emerging markets, 15% intermediate domestic government bonds, 10% domestic Treasury bills, 15% REITs, 10% gold. Annual exact-target review is Wealtharr policy, not an author claim.",
    research:["https://portfoliocharts.com/2018/10/01/try-a-modern-spin-on-a-classic-idea-with-the-pinwheel-portfolio/"],
    risks:["International sleeve must not silently double-count emerging allocation","REIT and commodity mapping","Bill maturity and cash sweep"]
  },
  seedDefinition:null,specCard:"docs/strategy-specs/pinwheel.md",goldenTests:"tests/group-3-reference.test.ts"
};
