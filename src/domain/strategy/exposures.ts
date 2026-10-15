import {GROUP4_EXPOSURES} from "./group4-exposures";
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
  assetClass: "EQUITY" | "BOND" | "CASH" | "COMMODITY" | "MULTI_ASSET";
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

const BASE_EXPOSURES: readonly ExposureDefinition[] = [
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


  {id:"G3_TDF_2050",assetClass:"MULTI_ASSET",leverage:1,description:"Unleveraged target retirement-date 2050 multi-asset fund with its own managed equity/bond glide path",region:"GLOBAL",maturityBand:"ALL_MATURITIES",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Single target-date retirement fund explicitly labelled 2050 vintage; holds global equities and bonds and adjusts internal risk mix by its verified 2050 fund glide path",domicileRequirement:"Only a 2050 target-date fund independently verified eligible for customer wrapper, country and broker; never another retirement vintage"},
  {id:"G3_TRINITY_US_LARGE_SIGNAL",assetClass:"EQUITY",leverage:1,description:"US broad large-cap blend total-return signal only (broad US large-cap blend equivalent); required for scoring and never a direct stock sleeve",region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"US broad large-cap blend total-return signal only (broad US large-cap blend equivalent); required for scoring and never a direct stock sleeve",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_US_LARGE_VALUE",assetClass:"EQUITY",leverage:1,description:"US large-cap value-factor equities (IWD style), not blended with momentum fund",region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"US large-cap value-factor equities (IWD style), not blended with momentum fund",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_US_LARGE_MOMENTUM",assetClass:"EQUITY",leverage:1,description:"US large-cap systematic momentum equity exposure (PDP-style), not index blend",region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"US large-cap systematic momentum equity exposure (PDP-style), not index blend",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_DEVELOPED_VALUE",assetClass:"EQUITY",leverage:1,description:"Developed ex-US value-equity portfolio (EFV-style), no emerging allocation",region:"DEVELOPED_EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Developed ex-US value-equity portfolio (EFV-style), no emerging allocation",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_EMERGING",assetClass:"EQUITY",leverage:1,description:"Diversified emerging equity blend, not developed equity",region:"EMERGING_MARKETS",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Diversified emerging equity blend, not developed equity",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_US_CORPORATE_IG",assetClass:"BOND",leverage:1,description:"Investment-grade US corporate bond sleeve, corporate-only not broad aggregate",region:"US",maturityBand:"ALL_MATURITIES",currencyPolicy:"UNHEDGED",creditQuality:"INVESTMENT_GRADE",coverage:"Investment-grade US corporate bond sleeve, corporate-only not broad aggregate",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_US_LONG_TREASURY",assetClass:"BOND",leverage:1,description:"Long-duration nominal US Treasuries (TLT-style), no investment-grade corporates",region:"US",maturityBand:"LONG",currencyPolicy:"UNHEDGED",creditQuality:"INVESTMENT_GRADE",coverage:"Long-duration nominal US Treasuries (TLT-style), no investment-grade corporates",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_FOREIGN_GOVT_10Y",assetClass:"BOND",leverage:1,description:"Developed non-US government debt near ten-year term (BWX-style), local currency unhedged",region:"DEVELOPED_EX_US",maturityBand:"INTERMEDIATE",currencyPolicy:"UNHEDGED",creditQuality:"INVESTMENT_GRADE",coverage:"Developed non-US government debt near ten-year term (BWX-style), local currency unhedged",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_US_TIPS",assetClass:"BOND",leverage:1,description:"US Treasury inflation-protected bonds; real-yield sovereign debt",region:"US",maturityBand:"ALL_MATURITIES",currencyPolicy:"UNHEDGED",creditQuality:"INVESTMENT_GRADE",coverage:"US Treasury inflation-protected bonds; real-yield sovereign debt",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_BROAD_COMMODITIES",assetClass:"COMMODITY",leverage:1,description:"Broad unleveraged futures-based commodity index (GSG-style), not equity miners",region:"GLOBAL",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Broad unleveraged futures-based commodity index (GSG-style), not equity miners",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_GOLD",assetClass:"COMMODITY",leverage:1,description:"Physical bullion gold spot exposure (GLD-style), not gold mining equity",region:"GLOBAL",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Physical bullion gold spot exposure (GLD-style), not gold mining equity",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_US_REITS",assetClass:"EQUITY",leverage:1,description:"Diversified US equity REITs (VNQ-style), not mortgage-backed bond fund",region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Diversified US equity REITs (VNQ-style), not mortgage-backed bond fund",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  {id:"G3_TRINITY_US_TBILLS",assetClass:"CASH",leverage:1,description:"Short-dated US Treasury bill fund (BIL-style), not bank cash or long nominal Treasury",region:"US",maturityBand:"SHORT",currencyPolicy:"UNHEDGED",creditQuality:"INVESTMENT_GRADE",coverage:"Short-dated US Treasury bill fund (BIL-style), not bank cash or long nominal Treasury",domicileRequirement:"Verified exact, investor-account-eligible security with licensed adjusted return/quote evidence; no unsourced alternative"},
  // Group 3 reference-specific, exact economic exposures (no default trading instruments).
  {id:"G3_US_LARGE_CAP_BLEND",assetClass:"EQUITY",leverage:1,description:"United States large-capitalisation blend equities",region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"US large-cap blend market, not total US stocks",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_US_SMALL_CAP_BLEND",assetClass:"EQUITY",leverage:1,description:"United States small-capitalisation blend equities",region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"US small-cap blend, not mid/large-cap stocks",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_DEV_EX_US_SMALL_CAP_BLEND",assetClass:"EQUITY",leverage:1,description:"Developed ex-US small-capitalisation blend equities",region:"DEVELOPED_EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Developed markets excluding the US; small-cap blend, not emerging or large-cap",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_US_SHORT_TREASURY",assetClass:"BOND",leverage:1,description:"Short-maturity nominal United States Treasury debt",region:"US",maturityBand:"SHORT",currencyPolicy:"UNHEDGED",creditQuality:"INVESTMENT_GRADE",coverage:"United States Treasury bonds/notes with short maturity, no corporate credit",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_US_SMALL_CAP_VALUE",assetClass:"EQUITY",leverage:1,description:"US small-cap value-factor equities",region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"US small-cap stocks with systematic value factor; excludes small blend",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_DEV_EX_US_SMALL_CAP_VALUE",assetClass:"EQUITY",leverage:1,description:"Developed ex-US small-cap value-factor equities",region:"DEVELOPED_EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Developed ex-US small-cap stocks with systematic value tilt, no emerging markets",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_EM_VALUE",assetClass:"EQUITY",leverage:1,description:"Emerging-market value-factor equities",region:"EMERGING_MARKETS",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Emerging equity value factor (not a broad emerging-market blend proxy)",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_US_FIVE_YEAR_TREASURY",assetClass:"BOND",leverage:1,description:"Nominal US Treasury notes centred on five-year maturity",region:"US",maturityBand:"INTERMEDIATE",currencyPolicy:"UNHEDGED",creditQuality:"INVESTMENT_GRADE",coverage:"Direct five-year US Treasury note or a fund specifically tracking five-year US Treasury notes; no corporate exposure",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_DEV_EX_US_LARGE_CAP_BLEND",assetClass:"EQUITY",leverage:1,description:"Developed ex-US large-cap blend equities",region:"DEVELOPED_EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Developed ex-US large-cap blend, excluding small-cap and emerging markets",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_EM_LARGE_CAP_BLEND",assetClass:"EQUITY",leverage:1,description:"Emerging-market large-cap blend equities",region:"EMERGING_MARKETS",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Emerging-markets large-cap blend, not developed-world or narrow value sector",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_US_INTERMEDIATE_TREASURY",assetClass:"BOND",leverage:1,description:"US intermediate-maturity nominal Treasury bonds",region:"US",maturityBand:"INTERMEDIATE",currencyPolicy:"UNHEDGED",creditQuality:"INVESTMENT_GRADE",coverage:"Intermediate-maturity US Treasuries only, not broad aggregate or short bills",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_US_TREASURY_BILLS",assetClass:"CASH",leverage:1,description:"Short-dated US Treasury bills",region:"US",maturityBand:"SHORT",currencyPolicy:"UNHEDGED",creditQuality:"INVESTMENT_GRADE",coverage:"US Treasury bills with short dated maturity, not bank deposit or long Treasury fund",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_US_REITS",assetClass:"EQUITY",leverage:1,description:"United States listed equity REITs",region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Diversified US listed equity REITs, not global real estate or mortgage REIT-only",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
  {id:"G3_PHYSICAL_GOLD",assetClass:"COMMODITY",leverage:1,description:"Unleveraged investment-gold bullion",region:"GLOBAL",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Physically backed investment bullion tracking spot gold, excluding mining equities",domicileRequirement:"Only a fund/security independently verified eligible for the investor's country, wrapper and broker; no ticker substitution or assumed listing"},
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
  // Merriman's 2026 ten-sleeve 50/50 reference needs separate international value and small-factor
  // exposures. Never collapse these into generic developed-market equity to force broker eligibility.
  {
    id:"DEVELOPED_EX_US_LARGE_CAP_VALUE",assetClass:"EQUITY",leverage:1,
    description:"Developed markets outside the US, large-cap value factor equities",
    region:"DEVELOPED_EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",
    creditQuality:"NOT_APPLICABLE",coverage:"Diversified developed ex-US large-cap equities selected for value characteristics",
    domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"
  },
  {
    id:"DEVELOPED_EX_US_SMALL_CAP_BLEND",assetClass:"EQUITY",leverage:1,
    description:"Developed markets outside the US, diversified small-cap equities",
    region:"DEVELOPED_EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",
    creditQuality:"NOT_APPLICABLE",coverage:"Developed ex-US small capitalisation blend equities",
    domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"
  },
  {
    id:"DEVELOPED_EX_US_SMALL_CAP_VALUE",assetClass:"EQUITY",leverage:1,
    description:"Developed markets outside the US, small-cap value equities",
    region:"DEVELOPED_EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",
    creditQuality:"NOT_APPLICABLE",coverage:"Developed ex-US small capitalisation equities selected for value characteristics",
    domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"
  },
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

// Group 2 semantic qualifiers for legacy generic economic exposures; market mapping remains fail-closed.
const GROUP_2_DESCRIPTORS:ReadonlyMap<string,Partial<ExposureDefinition>>=new Map([
  ["BROAD_EQUITY",{region:"GLOBAL",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Diversified broad equity markets; no single-country concentration assumed",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["LONG_TREASURY",{region:"US",maturityBand:"LONG",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"Long-duration US government Treasury obligations",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["INTERMEDIATE_TREASURY",{region:"US",maturityBand:"INTERMEDIATE",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"Intermediate-maturity US Treasury obligations",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["GOLD",{region:"GLOBAL",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Physical gold bullion price exposure, not gold-mining equities",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["BROAD_COMMODITIES",{region:"GLOBAL",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Diversified broad commodity futures index exposure, not individual gold or commodity equities",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_EQUITY_3X_LONG",{region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"Daily-reset 3x S&P 500 equity exposure; fund structural risks and exact index must be evidenced",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["LONG_TREASURY_3X_LONG",{region:"US",maturityBand:"LONG",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"Daily-reset 3x US 20+-year Treasury bond exposure, not 3x 7-10-year",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_LARGE_CAP",{region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"Broad US large-cap equity blend",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_LARGE_CAP_VALUE",{region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"Diversified US large-cap value equities",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_SMALL_CAP_BLEND",{region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"Diversified US small-cap blend equities",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_SMALL_CAP_VALUE",{region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"Diversified US small-cap value equities",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["DEVELOPED_EX_US_LARGE_CAP",{region:"DEVELOPED_EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Developed ex-US large-cap blend equities",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_INTERMEDIATE_TREASURY",{region:"US",maturityBand:"INTERMEDIATE",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"US intermediate-maturity Treasuries",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_REITS",{region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"Broad US listed equity REITs, not generic global real-estate equity",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_TOTAL_EQUITY",{region:"US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"LOCAL",creditQuality:"NOT_APPLICABLE",coverage:"Total US stock market, large/mid/small capitalizations",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["TOTAL_EX_US_EQUITY",{region:"EX_US",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"All-cap developed and emerging markets equities excluding US",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_AGGREGATE_BONDS",{region:"US",maturityBand:"ALL_MATURITIES",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"US investment-grade aggregate bonds incl government, corporate and securitised",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["EMERGING_MARKETS_EQUITY",{region:"EMERGING_MARKETS",maturityBand:"NOT_APPLICABLE",currencyPolicy:"UNHEDGED",creditQuality:"NOT_APPLICABLE",coverage:"Broad emerging markets equities",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
  ["US_TIPS",{region:"US",maturityBand:"ALL_MATURITIES",currencyPolicy:"LOCAL",creditQuality:"INVESTMENT_GRADE",coverage:"US Treasury inflation-protected securities; no nominal Treasury substitute",domicileRequirement:"Only an evidenced eligible trading line for the investor's country, wrapper and broker"}],
]);
export const EXPOSURES:readonly ExposureDefinition[]=[...GROUP4_EXPOSURES,...BASE_EXPOSURES.map((exposure)=>({
  ...exposure,...(GROUP_2_DESCRIPTORS.get(exposure.id)??{})
}))];
const byId = new Map(EXPOSURES.map((exposure) => [exposure.id,exposure]));

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
