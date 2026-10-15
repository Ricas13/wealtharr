/**
 * Registry of the economic exposures strategies may reference. Strategies name exposures, never
 * tickers or funds; the instrument mapping layer resolves an exposure to a tradable line per
 * jurisdiction. Adding an exposure here is a deliberate, reviewed change.
 */
export type MaturityBand = "ALL_MATURITIES" | "SHORT" | "INTERMEDIATE" | "LONG" | "NOT_APPLICABLE";
/**
 * How the exposure treats the currency of its underlying assets relative to the investor's base
 * currency. UNHEDGED holds the underlying currencies; GBP_HEDGED hedges them back to sterling;
 * LOCAL means the exposure is wholly in one currency (its own home currency).
 */
export type CurrencyPolicy = "UNHEDGED" | "GBP_HEDGED" | "LOCAL";

export type ExposureDefinition = {
  id: string;
  assetClass: "EQUITY" | "BOND" | "CASH" | "COMMODITY";
  /** Nominal daily leverage multiple the exposure is defined with. */
  leverage: number;
  description: string;
  /**
   * Structured descriptor. Optional so that legacy, deliberately vague exposures stay valid; an
   * exposure used by a strategy that is released as complete must carry every field required by
   * `isFullyDescribedExposure`.
   */
  region?: string;
  maturityBand?: MaturityBand;
  currencyPolicy?: CurrencyPolicy;
  /** Credit quality of a bond exposure, or NOT_APPLICABLE. */
  creditQuality?: "INVESTMENT_GRADE" | "NOT_APPLICABLE";
  /** What a verified listing must cover; the market-coverage claim of the exposure. */
  coverage?: string;
  /** Requirement a product must meet at fund level (domicile, wrapper eligibility). */
  domicileRequirement?: string;
  /** True when the definition is a Wealtharr model convention awaiting owner confirmation. */
  modelConvention?: boolean;
};

const def = (id: string, assetClass: ExposureDefinition["assetClass"], description: string, leverage = 1): ExposureDefinition => ({ id, assetClass, leverage, description });

/**
 * True when every descriptor field that makes an exposure unambiguous is present. Used by the
 * release predicate: a strategy cannot be complete while it references a vaguely described exposure.
 */
export function isFullyDescribedExposure(exposure: ExposureDefinition | undefined): boolean {
  if (!exposure) return false;
  if (!exposure.description.trim() || !Number.isFinite(exposure.leverage) || exposure.leverage <= 0) return false;
  if (!exposure.region || !exposure.maturityBand || !exposure.currencyPolicy || !exposure.creditQuality) return false;
  if (!exposure.coverage || !exposure.domicileRequirement) return false;
  return true;
}

export const EXPOSURES: readonly ExposureDefinition[] = [
  // Group 1 source-specific US-reference exposures; market mappings remain operator verified.
  {id:"G1_US_TOTAL_EQUITY",assetClass:"EQUITY",description:"US total stock market large, mid and small equities",leverage:1,region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Broad US total-market equity index",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_EX_US_TOTAL_EQUITY",assetClass:"EQUITY",description:"Developed and emerging equity markets outside the US",leverage:1,region:"EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Broad total international developed and emerging equity index excluding US",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_US_AGGREGATE_BONDS",assetClass:"BOND",description:"US investment-grade aggregate bond market",leverage:1,region:"US",maturityBand:"ALL_MATURITIES",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"US investment grade government, agency, mortgage and corporate aggregate index",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_US_LARGE_BLEND",assetClass:"EQUITY",description:"US large-cap blend stocks",leverage:1,region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"US large capitalisation diversified blend index",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_US_SMALL_VALUE",assetClass:"EQUITY",description:"US small-cap value stocks",leverage:1,region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"US small capitalisation value-style index",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_US_LONG_TREASURY",assetClass:"BOND",description:"Long-term US Treasury securities",leverage:1,region:"US",maturityBand:"LONG",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"US Treasury securities with long remaining maturities, no corporate credit",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_US_SHORT_TREASURY",assetClass:"BOND",description:"Short-term US Treasury securities",leverage:1,region:"US",maturityBand:"SHORT",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"US Treasury notes and bills of short maturity, no corporate credit",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_US_TREASURY_BILLS",assetClass:"CASH",description:"Short-dated US Treasury bills (not generic cash)",leverage:1,region:"US",maturityBand:"SHORT",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"Direct US Treasury bills or single-fund Treasury-bill-index exposure",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_PHYSICAL_GOLD",assetClass:"COMMODITY",description:"Unleveraged physical gold spot price exposure",leverage:1,region:"GLOBAL",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Physical gold bullion or physically backed eligible security, not miners/futures leverage",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_SP500_INDEX",assetClass:"EQUITY",description:"Low-cost S&P 500 market capitalisation index exposure",leverage:1,region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"S&P 500 index of large US publicly traded companies",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},
  {id:"G1_US_SHORT_GOVERNMENT",assetClass:"BOND",description:"Short-term US government debt",leverage:1,region:"US",maturityBand:"SHORT",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"US federal government short-term securities, not corporate bonds",domicileRequirement:"Mapping must be independently verified for each jurisdiction and wrapper; no default ticker or jurisdiction eligibility is asserted"},

  def("BROAD_EQUITY", "EQUITY", "Diversified global or broad-market equities"),
  def("DOMESTIC_EQUITY", "EQUITY", "Broad equities of the investor's home market"),
  def("INTERNATIONAL_EQUITY", "EQUITY", "Broad equities outside the investor's home market"),
  def("US_LARGE_CAP", "EQUITY", "US large-capitalisation equities"),
  def("US_LARGE_CAP_VALUE", "EQUITY", "US large-cap value factor equities"),
  def("US_SMALL_CAP_BLEND", "EQUITY", "US small-cap diversified blend equities"),
  def("US_TOTAL_EQUITY", "EQUITY", "US total market equities including small and mid cap"),
  def("TOTAL_EX_US_EQUITY", "EQUITY", "Total international equities outside the US, developed and emerging"),
  def("US_AGGREGATE_BONDS", "BOND", "US investment-grade aggregate bonds, including Treasuries, mortgage and corporate bonds"),
  def("DEVELOPED_EX_US_LARGE_CAP", "EQUITY", "Developed-market large-cap equity outside the United States"),
  def("EMERGING_MARKETS_EQUITY", "EQUITY", "Emerging-market equity"),
  def("US_REITS", "EQUITY", "US listed real-estate investment trusts"),
  def("US_SMALL_CAP_VALUE", "EQUITY", "US small-capitalisation value equities"),
  def("US_EQUITY_3X_LONG", "EQUITY", "US large-cap equities with 3x daily-reset leverage", 3),
  def("NASDAQ_100_3X_LONG", "EQUITY", "Nasdaq-100 equities with 3x daily-reset leverage", 3),
  def("AGGREGATE_BONDS", "BOND", "Broad investment-grade bond market"),
  def("LONG_TREASURY", "BOND", "Long-duration government bonds"),
  def("INTERMEDIATE_TREASURY", "BOND", "Intermediate-duration government bonds"),
  def("US_INTERMEDIATE_TREASURY", "BOND", "United States intermediate-maturity Treasury securities"),
  def("US_TIPS", "BOND", "United States Treasury inflation-protected securities"),
  def("SHORT_TREASURY", "BOND", "Short-duration government bonds"),
  def("LONG_TREASURY_3X_LONG", "BOND", "Long-duration government bonds with 3x daily-reset leverage", 3),
  def("CASH_BILLS", "CASH", "Cash or short-dated government bills"),
  def("GOLD", "COMMODITY", "Physical-gold-backed exposure"),
  def("BROAD_COMMODITIES", "COMMODITY", "Diversified commodities basket"),
  // Wealtharr 60/40 model exposures (docs/strategy-specs/60-40.md). These names and their
  // definitions are a Wealtharr model convention that the owner must confirm; they are not taken
  // from the Bogleheads wiki, which names only asset classes.
  {
    id: "GLOBAL_EQUITY_ALL_CAP_UNHEDGED", assetClass: "EQUITY", leverage: 1,
    description: "Global all-capitalisation equities across developed and emerging markets, unhedged and unleveraged",
    region: "GLOBAL", maturityBand: "NOT_APPLICABLE", currencyPolicy: "UNHEDGED", creditQuality: "NOT_APPLICABLE",
    coverage: "Large, mid and small capitalisation companies across developed and emerging markets; a single global all-cap index or an equivalent single fund",
    domicileRequirement: "A fund the investor can hold in a UK ISA; the accepted domiciles and fund types are an owner decision",
    modelConvention: true
  },
  {
    id: "GLOBAL_AGGREGATE_BONDS_GBP_HEDGED", assetClass: "BOND", leverage: 1,
    description: "Global investment-grade aggregate bonds (government, government-related and corporate) of all maturities, hedged to pound sterling and unleveraged",
    region: "GLOBAL", maturityBand: "ALL_MATURITIES", currencyPolicy: "GBP_HEDGED", creditQuality: "INVESTMENT_GRADE",
    coverage: "Investment-grade government, government-related and corporate bonds of all maturities across the markets of one global aggregate index; a single global aggregate index or an equivalent single fund",
    domicileRequirement: "A fund the investor can hold in a UK ISA; the accepted domiciles and fund types are an owner decision",
    modelConvention: true
  }
];

const byId = new Map(EXPOSURES.map((exposure) => [exposure.id, exposure]));

export function getExposure(id: string) {
  return byId.get(id);
}

export function isRegisteredExposure(id: string) {
  return byId.has(id);
}

/** Throws UNREGISTERED_EXPOSURE:<id> for the first exposure not in the registry. */
export function assertRegisteredExposures(ids: readonly string[]) {
  for (const id of ids) if (!byId.has(id)) throw new Error("UNREGISTERED_EXPOSURE:" + id);
}
