/** Immutable Group 4 strategy algorithm variants. Names are economic exposures;
 * actual ETF/trading-line mappings are separately verified by market and wrapper. */
export const Q4_PAA_RISK=[
 "Q4_SP500","Q4_NASDAQ100","Q4_RUSSELL2000","Q4_MSCI_EUROPE",
 "Q4_MSCI_JAPAN","Q4_MSCI_EM","Q4_US_REITS","Q4_SP_GSCI",
 "Q4_GOLD","Q4_US_HIGH_YIELD_CORPORATE","Q4_US_IG_CORPORATE","Q4_US_20Y_TREASURY"
] as const;
export const Q4_VAA_G4_RISK=["Q4_SP500","Q4_MSCI_EAFE","Q4_MSCI_EM","Q4_US_AGGREGATE_BONDS"] as const;
export const Q4_VAA_SAFE=["Q4_US_IG_CORPORATE","Q4_US_7_10Y_TREASURY","Q4_US_1_3Y_TREASURY"] as const;
export const Q4_IVY_RISK=["Q4_SP500","Q4_MSCI_EAFE","Q4_US_7_10Y_TREASURY","Q4_SP_GSCI","Q4_US_REITS"] as const;
export const Q4_ERC_RISK=["Q4_SP500","Q4_MSCI_EAFE","Q4_US_7_10Y_TREASURY","Q4_GOLD"] as const;
export const TACTICAL_VERSIONS={
 "trend-200d":{variant:"TREND_200_DAILY",riskAssets:["Q4_SP500"],defensiveAssets:["Q4_US_3M_TBILLS"]},
 "risk-parity":{variant:"RISK_PARITY_ERC_252",riskAssets:Q4_ERC_RISK,defensiveAssets:[]},
 "dual-momentum":{variant:"GEM_CLASSIC",riskAssets:["Q4_SP500","Q4_MSCI_ACWI_EX_US"],defensiveAssets:["Q4_US_3M_TBILLS","Q4_US_AGGREGATE_BONDS"]},
 "gtaa-ivy":{variant:"IVY_GTAA5",riskAssets:Q4_IVY_RISK,defensiveAssets:["Q4_US_3M_TBILLS"]},
 "paa":{variant:"PAA_12_A2",riskAssets:Q4_PAA_RISK,defensiveAssets:["Q4_US_7_10Y_TREASURY"]},
 "vaa":{variant:"VAA_G4",riskAssets:Q4_VAA_G4_RISK,defensiveAssets:Q4_VAA_SAFE},
 "vaa-g12":{variant:"VAA_G12",riskAssets:Q4_PAA_RISK,defensiveAssets:Q4_VAA_SAFE}
} as const;
export type Q4Key=keyof typeof TACTICAL_VERSIONS;
export function q4Config(key:Q4Key):Record<string,unknown>{
 const row=TACTICAL_VERSIONS[key];
 return {variant:row.variant,riskAssets:[...row.riskAssets],defensiveAssets:[...row.defensiveAssets],
  reviewFrequency:"MONTHLY",rebalanceThreshold:"0"};
}
