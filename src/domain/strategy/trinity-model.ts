/**
 * Reproducible Trinity proxy from Tactfolio's 2016 Faber implementation.
 * This is NOT Cambria's proprietary fund-security tilts or an index-return clone.
 * The signal universe is scored separately from the securities actually held;
 * US equities score on broad SPY-equivalent total-return history but invest
 * half value, half momentum as specified by the reference model.
 * https://tactfolio.com/strategies/trinity-portfolio
 */
export const TRINITY_VERSION="TACTFOLIO_2016_PROXY" as const;
export const TRINITY_US_SIGNAL="G3_TRINITY_US_LARGE_SIGNAL";
export const TRINITY_VALUE="G3_TRINITY_US_LARGE_VALUE";
export const TRINITY_MOMENTUM="G3_TRINITY_US_LARGE_MOMENTUM";
export const TRINITY_DEV_VALUE="G3_TRINITY_DEVELOPED_VALUE";
export const TRINITY_EM="G3_TRINITY_EMERGING";
export const TRINITY_CORP="G3_TRINITY_US_CORPORATE_IG";
export const TRINITY_LONG="G3_TRINITY_US_LONG_TREASURY";
export const TRINITY_FOREIGN="G3_TRINITY_FOREIGN_GOVT_10Y";
export const TRINITY_TIPS="G3_TRINITY_US_TIPS";
export const TRINITY_COMMODITIES="G3_TRINITY_BROAD_COMMODITIES";
export const TRINITY_GOLD="G3_TRINITY_GOLD";
export const TRINITY_REITS="G3_TRINITY_US_REITS";
export const TRINITY_BILLS="G3_TRINITY_US_TBILLS";

export const TRINITY_SIGNALS=[
 TRINITY_US_SIGNAL,TRINITY_DEV_VALUE,TRINITY_EM,TRINITY_CORP,TRINITY_LONG,
 TRINITY_FOREIGN,TRINITY_TIPS,TRINITY_COMMODITIES,TRINITY_GOLD,TRINITY_REITS
] as const;

/** Whole-portfolio buy-and-hold half (exact percentages from Tactfolio implementation). */
export const TRINITY_STATIC=[
 {exposure:TRINITY_VALUE,weight:"0.045"},
 {exposure:TRINITY_MOMENTUM,weight:"0.045"},
 {exposure:TRINITY_DEV_VALUE,weight:"0.0675"},
 {exposure:TRINITY_EM,weight:"0.0225"},
 {exposure:TRINITY_CORP,weight:"0.099"},
 {exposure:TRINITY_LONG,weight:"0.0675"},
 {exposure:TRINITY_FOREIGN,weight:"0.072"},
 {exposure:TRINITY_TIPS,weight:"0.009"},
 {exposure:TRINITY_COMMODITIES,weight:"0.025"},
 {exposure:TRINITY_GOLD,weight:"0.025"},
 {exposure:TRINITY_REITS,weight:"0.0225"}
] as const;
export const TRINITY_TRADE_UNIVERSE=[...TRINITY_STATIC.map(x=>x.exposure),TRINITY_BILLS] as const;
export const TRINITY_CONFIG={
  variant:TRINITY_VERSION,
  reviewFrequency:"MONTHLY",
  reviewSchedule:"CALENDAR_MONTH_END",
  reviewTimezone:"America/New_York",
  reviewCutoffLocal:"16:00",
  businessDayConvention:"PREVIOUS",
  marketHolidays:[],
  // Signal timing is the close of the final NYSE trading day, followed by
  // next executable order: never use the same close for a retrospectively
  // generated fill.
  rebalanceThreshold:"0.00",
  staticWeight:"0.50",
  tacticalWeight:"0.50",
  staticAllocations:TRINITY_STATIC.map(x=>({...x})),
  signalUniverse:[...TRINITY_SIGNALS],
  defensiveAsset:TRINITY_BILLS,
  momentumLookbacks:[1,3,6,12],
  topCount:5,
  trendMonths:10
} as const;
