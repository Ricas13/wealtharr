import type {ExposureDefinition} from "./exposures";
/**
 * Explicit benchmark universes for Wealtharr's Group 4 tactical reference variants.
 * These are economic benchmarks, NOT permission to use US-domiciled ETFs in UK wrappers.
 * Exact index fidelity, distribution/FX conventions, licence and purchase eligibility
 * must be evidenced per instrument/market before an admin can enable one.
 */
type Row={id:string;assetClass:ExposureDefinition["assetClass"];region:string;coverage:string;band:ExposureDefinition["maturityBand"];quality:ExposureDefinition["creditQuality"];currency:ExposureDefinition["currencyPolicy"]};
const rows:Row[]=[
 {id:"Q4_SP500",assetClass:"EQUITY",region:"US",coverage:"S&P 500 large-cap total-return equity index",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_NASDAQ100",assetClass:"EQUITY",region:"US",coverage:"NASDAQ-100 total-return nonfinancial index",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_RUSSELL2000",assetClass:"EQUITY",region:"US",coverage:"Russell 2000 small-cap total-return equity index",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_MSCI_EUROPE",assetClass:"EQUITY",region:"EUROPE",coverage:"MSCI Europe total-return index",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_MSCI_JAPAN",assetClass:"EQUITY",region:"JAPAN",coverage:"MSCI Japan total-return index",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_MSCI_EM",assetClass:"EQUITY",region:"EMERGING_MARKETS",coverage:"MSCI Emerging Markets total-return equity index",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_US_REITS",assetClass:"EQUITY",region:"US",coverage:"US listed equity REIT total-return benchmark corresponding to IYR/NAREIT real-estate sleeve",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_SP_GSCI",assetClass:"COMMODITY",region:"GLOBAL",coverage:"S&P GSCI broad commodity futures total-return index; rolling futures exposure, not physical commodity equities",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_GOLD",assetClass:"COMMODITY",region:"GLOBAL",coverage:"Allocated physical gold bullion exposure analogous to GLD including applicable product expenses",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_US_HIGH_YIELD_CORPORATE",assetClass:"BOND",region:"US",coverage:"USD sub-investment-grade liquid corporate bond index represented by HYG",band:"ALL_MATURITIES",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_US_IG_CORPORATE",assetClass:"BOND",region:"US",coverage:"USD investment-grade liquid corporate bond index represented by LQD",band:"ALL_MATURITIES",quality:"INVESTMENT_GRADE",currency:"UNHEDGED"},
 {id:"Q4_US_20Y_TREASURY",assetClass:"BOND",region:"US",coverage:"US Treasury securities with remaining maturities 20 years or longer, represented by TLT",band:"LONG",quality:"INVESTMENT_GRADE",currency:"UNHEDGED"},
 {id:"Q4_US_7_10Y_TREASURY",assetClass:"BOND",region:"US",coverage:"US Treasury securities with remaining maturities 7–10 years, represented by IEF",band:"INTERMEDIATE",quality:"INVESTMENT_GRADE",currency:"UNHEDGED"},
 {id:"Q4_US_1_3Y_TREASURY",assetClass:"BOND",region:"US",coverage:"US Treasury securities with remaining maturities 1–3 years, represented by SHY",band:"SHORT",quality:"INVESTMENT_GRADE",currency:"UNHEDGED"},
 {id:"Q4_US_AGGREGATE_BONDS",assetClass:"BOND",region:"US",coverage:"Bloomberg US Aggregate bond total-return benchmark, investment-grade USD bonds, represented by AGG",band:"ALL_MATURITIES",quality:"INVESTMENT_GRADE",currency:"UNHEDGED"},
 {id:"Q4_MSCI_EAFE",assetClass:"EQUITY",region:"DEVELOPED_EX_US_CANADA",coverage:"MSCI EAFE developed-markets total-return equity benchmark, represented by EFA",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_MSCI_ACWI_EX_US",assetClass:"EQUITY",region:"WORLD_EX_US",coverage:"MSCI ACWI ex USA total-return equity benchmark including emerging markets",band:"NOT_APPLICABLE",quality:"NOT_APPLICABLE",currency:"UNHEDGED"},
 {id:"Q4_US_3M_TBILLS",assetClass:"CASH",region:"US",coverage:"3-month US Treasury bill total-return series, not an uninvested cash balance",band:"SHORT",quality:"INVESTMENT_GRADE",currency:"UNHEDGED"}
];
export const GROUP4_EXPOSURES:readonly ExposureDefinition[]=rows.map(row=>({
 id:row.id,assetClass:row.assetClass,leverage:1,
 description:row.coverage,region:row.region,maturityBand:row.band,
 currencyPolicy:row.currency,creditQuality:row.quality,coverage:row.coverage,
 domicileRequirement:"Broker/wrapper eligible listing matching this exact benchmark, net distributions and currency; verified by regional mapping evidence, never inferred from a similar ticker"
}));
