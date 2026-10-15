import type {StrategyPlugin} from "./plugin";
import {TWO_FUNDS_2050_CONFIG} from "../two-funds-engine";

/**
 * Named 2050-vintage implementation of Merriman Foundation Moderate 2FFL.
 * Annual US SCV target = 1.5% x remaining whole calendar years, capped 100%;
 * target-date 2050 fund = remainder. No generic/mismatched TDF may qualify.
 */
export const plugin:StrategyPlugin={
  key:"two-funds-for-life",
  profile:{
    key:"two-funds-for-life",name:"Two Funds for Life — Moderate (2050 retirement)",engine:"TWO_FUNDS_MODERATE",
    launchState:"DRAFT_REQUIRES_VERIFICATION",config:{...TWO_FUNDS_2050_CONFIG},
    rules:"Paul Merriman Foundation Moderate 2FFL, retirement cohort 2050: annual small-cap value target is 1.5% times calendar years until retirement, max 100%; remaining portfolio in exactly a target-date 2050 fund. At or after 2050: 100% 2050 TDF. Calendar-year rounding, annual review and precise 2050 cohort are explicitly Wealtharr implementation conventions. No fund outside the eligible 2050 target-date vintage qualifies.",
    research:["https://www.paulmerriman.com/two-funds-for-life-calculator"],
    risks:["Target-date fund internally changes its own asset allocation","US small-cap value factor concentration","Retirement year is fixed to 2050 in this named strategy, not investor-editable"]
  },
  seedDefinition:{name:"Two Funds for Life — Moderate (2050 retirement)",family:"DYNAMIC_ALLOCATION",
    description:"Merriman Moderate 2050 target-date fund and annually decreasing US small-value allocation",
    engine:"TWO_FUNDS_MODERATE",proprietary:false,enabled:false,supportedRegions:[],
    supportedWrappers:[],initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:true},
  specCard:"docs/strategy-specs/two-funds-for-life.md",
  goldenTests:"tests/two-funds-engine.test.ts",releaseStatus:"COMPLETE"
};
