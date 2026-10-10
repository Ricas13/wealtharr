/**
 * Registry of the economic exposures strategies may reference. Strategies name exposures, never
 * tickers or funds; the instrument mapping layer resolves an exposure to a tradable line per
 * jurisdiction. Adding an exposure here is a deliberate, reviewed change.
 */
export type ExposureDefinition = {
  id: string;
  assetClass: "EQUITY" | "BOND" | "CASH" | "COMMODITY";
  /** Nominal daily leverage multiple the exposure is defined with. */
  leverage: number;
  description: string;
};

const def = (id: string, assetClass: ExposureDefinition["assetClass"], description: string, leverage = 1): ExposureDefinition => ({ id, assetClass, leverage, description });

export const EXPOSURES: readonly ExposureDefinition[] = [
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
  def("BROAD_COMMODITIES", "COMMODITY", "Diversified commodities basket")
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
