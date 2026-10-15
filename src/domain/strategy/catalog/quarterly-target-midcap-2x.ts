import type {StrategyPlugin} from "./plugin";
import {LEVERAGE_DISCLOSURE} from "./plugin";

/**
 * Wealtharr owner-selected variant of the published quarterly-target ("Sig") family. It is a named
 * Wealtharr model, not the original author's product: rules that are not independently documented
 * are labelled as owner decisions on the specification card.
 */
export const plugin:StrategyPlugin={
  key:"quarterly-target-midcap-2x",
  profile:{
    key:"quarterly-target-midcap-2x",name:"US Mid-Cap 2x Quarterly Target",engine:"QUARTERLY_SIGNAL_TARGET",launchState:"DRAFT_REQUIRES_VERIFICATION",
    disclosure:LEVERAGE_DISCLOSURE,
    config:{
      ruleVersion:"WEALTHARR_OWNER_2026_V1",variant:"SIG_6",
      targetExposure:"US_MID_CAP_2X_LONG",safeExposure:"US_AGGREGATE_BONDS",targetLeverage:"2",
      quarterlyGrowth:"0.06",initialTargetRatio:"0.60",contributionTargetRatio:"0.50",buyBudgetRatio:"0.90",
      protection:{triggerRatio:"0.70",lookbackQuarters:8,skippedSells:1},
      spikeReset:{enabled:true,gainMultiple:"2",targetRatio:"0.60"},
      referenceCurrency:"USD",actWindowTradingDays:3,
      reviewFrequency:"QUARTERLY",reviewSchedule:"CALENDAR_QUARTER_END",
      reviewTimezone:"America/New_York",reviewCutoffLocal:"16:00",businessDayConvention:"PREVIOUS"
    },
    rules:"Wealtharr owner-selected quarterly target model: the us mid cap 2x long exposure is steered along a target line that grows 6% per quarter, funded from a US aggregate bond exposure. Starts 60/40. Sources and labelled assumptions are on the specification card.",
    research:["https://jasonkelly.com/2017/01/how-my-signal-system-works/","https://jasonkelly.com/resources/strategies/"],
    risks:["Daily-reset leverage: returns over longer periods can differ sharply from the stated multiple","The risk exposure can fall a great deal, and the bond fund can fall at the same time","Orders are only proposed: you place them with your own broker within the act window","Fund fees, tracking differences and availability depend on the listed products verified for your account type"]
  },
  seedDefinition:{
    name:"US Mid-Cap 2x Quarterly Target",family:"QUARTERLY_SIGNAL_TARGET",
    description:"Wealtharr owner-selected quarterly target model: the us mid cap 2x long exposure is steered along a target line that grows 6% per quarter, funded from a US aggregate bond exposure. Starts 60/40.",
    engine:"QUARTERLY_SIGNAL_TARGET",proprietary:false,enabled:false,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false
  },
  specCard:"docs/strategy-specs/quarterly-target-midcap-2x.md",
  goldenTests:"tests/quarterly-target-golden.test.ts",
  releaseStatus:"COMPLETE"
};
