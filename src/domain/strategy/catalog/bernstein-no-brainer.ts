import type {StrategyPlugin} from "./plugin";
import {fixed} from "./plugin";

/** US reference variant as documented by Portfolio Charts; annual review is Wealtharr policy. */
export const plugin:StrategyPlugin={
  key:"bernstein-no-brainer",
  profile:{
    key:"bernstein-no-brainer",name:"Bernstein No-Brainer — US reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["G3_US_LARGE_CAP_BLEND","0.25"],["G3_US_SMALL_CAP_BLEND","0.25"],["G3_DEV_EX_US_SMALL_CAP_BLEND","0.25"],["G3_US_SHORT_TREASURY","0.25"]],"ANNUAL"),
    rules:"US reference: 25% US large-cap blend, 25% US small-cap blend, 25% developed ex-US small-cap blend, and 25% US short Treasuries. Annual exact-target rebalance is a Wealtharr convention, not attributed to Bernstein. Pending verified economic-exposure descriptors and live market mapping.",
    research:["https://portfoliocharts.com/portfolios/no-brainer-portfolio/"],
    risks:["Small-cap and overseas equity concentration","Treasury maturity fidelity","USD foreign-exchange exposure"]
  },
  seedDefinition:{name:"Bernstein No-Brainer — US reference",family:"FIXED_ALLOCATION",description:"Source-locked Group 3 reference with precise economic exposures and annual Wealtharr rebalance",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,supportedRegions:[],supportedWrappers:[],initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:true},specCard:"docs/strategy-specs/bernstein-no-brainer.md",goldenTests:"tests/group-3-static-engine.test.ts"
  ,releaseStatus:"COMPLETE"
};
