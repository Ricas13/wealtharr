import type {StrategyPlugin} from "./plugin";
import {LEVERAGE_DISCLOSURE} from "./plugin";
import {KELLY_SIGNAL_REVISION} from "../kelly-signal";

export const CANONICAL_9SIG_CONFIG={
  targetExposure:"NASDAQ_100_3X_LONG",
  initialTargetRatio:"0.60",targetRate:"0.09",contributionTargetRatio:"0.50",
  maxCashUse:"0.90",tolerance:"0.01",reviewFrequency:"QUARTERLY",
  reviewCutoffLocal:"16:00",businessDayConvention:"PREVIOUS",marketHolidays:[]
} as const;

/**
 * 9Sig v1.1: the author's documented method (docs/strategy-specs/9sig.md, src/domain/strategy/kelly-signal.ts).
 * - Calendar quarter-end reviews at 16:00 America/New_York (R3); market holidays not yet source-verified (Q4).
 * - Line = actual post-order balance x 1.09 per quarter (R2, R4) + 50% of new cash incl. distributions (R5, R6).
 * - No tolerance band (R8). `tolerance:"0"` states that; the v1.1 calculation never reads it.
 * - reviewBuyCapRatio 0.90: AUTHOR-SOURCED (S4, a 2018 reply quoting the user guide), POSSIBLY OUTDATED (Q2b).
 * - initialTargetRatio 0.60: inherited v1.0 convention; the card marks 60/40 "Unverified as current" (Q2).
 * Not implemented (unverified): 30 Down, spike reset, base reset, bond-fund sleeve, withdrawal rule.
 */
export const CANONICAL_9SIG_V1_1_CONFIG={
  targetExposure:"NASDAQ_100_3X_LONG",
  methodRevision:KELLY_SIGNAL_REVISION,
  initialTargetRatio:"0.60",targetRate:"0.09",contributionTargetRatio:"0.50",
  reviewBuyCapRatio:"0.90",tolerance:"0",
  reviewFrequency:"QUARTERLY",reviewSchedule:"CALENDAR_QUARTER_END",
  reviewTimezone:"America/New_York",reviewCutoffLocal:"16:00",
  businessDayConvention:"PREVIOUS",marketHolidays:[]
} as const;

export const plugin:StrategyPlugin={
  key:"9sig",
  profile:null,
  codeRelease:{
    engine:"VALUE_TARGET",
    config:CANONICAL_9SIG_CONFIG,
    summary:"Quarterly signal-based value targeting; full source-methodology audit remains outstanding.",
    laterVersions:[{
      version:"1.1",
      effectiveFrom:"2026-10-12",
      config:CANONICAL_9SIG_V1_1_CONFIG,
      summary:"Author's quarterly signal method: calendar quarter ends, actual-balance anchor, 50% of new cash incl. distributions, one 90% buy cap per quarter (author-sourced, possibly outdated), no tolerance band. 30 Down and resets not implemented.",
      releaseNotes:"9Sig 1.1 follows Jason Kelly's published method more closely: reviews at calendar quarter ends; the line grows 9% per quarter from your actual balance after the last order; half of contributions and distributions are added; at most 90% of cash is used per quarter and a capped quarter closes cleanly; no 1% tolerance band. Pausing, resuming or upgrading never adds an extra growth step. The 30 Down rule, spike reset and base reset are not implemented. Upgrading is optional and must be confirmed by you.",
      disclosure:LEVERAGE_DISCLOSURE
    }]
  },
  seedDefinition:{
    name:"9Sig",family:"SIGNAL_VALUE_TARGET",description:"Rules-based value target strategy",
    engine:"VALUE_TARGET",proprietary:true,enabled:true,
    supportedRegions:[],supportedWrappers:[],
    initialVersion:"PUBLISHED",realignsResearchOnlyDefinition:false
  },
  specCard:null,
  goldenTests:"tests/value-target.test.ts"
};
