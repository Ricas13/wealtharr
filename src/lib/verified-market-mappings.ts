import "server-only";
import type { VerifiedCandidate } from "@/domain/strategy/market-eligibility";

/**
 * Admitted mappings are exact, enabled and have matching verified underlying exposure,
 * direction and leverage. A similar ticker / an import CANDIDATE must never qualify.
 * Dates are checked again by the pure eligibility resolver.
 */
export const VERIFIED_MARKET_MAPPINGS_SQL =
  'SELECT m.id::text AS id, m.economic_exposure AS "economicExposure", m.leverage::text AS leverage,' +
  ' m.direction, m.country, m.wrapper, m.broker, m.preferred_currency AS "preferredCurrency",' +
  ' m.fidelity, m.effective_from::text AS "effectiveFrom", m.effective_to::text AS "effectiveTo",' +
  ' tl.id::text AS "tradingLineId", tl.currency AS "tradingLineCurrency",' +
  ' tl.effective_from::text AS "tradingLineEffectiveFrom", tl.effective_to::text AS "tradingLineEffectiveTo",' +
  ' tl.ticker, tl.exchange' +
  ' FROM regional_instrument_mappings m' +
  ' JOIN trading_lines tl ON tl.id=m.trading_line_id' +
  ' JOIN instruments i ON i.id=tl.instrument_id AND i.economic_exposure=m.economic_exposure' +
  ' AND i.leverage=m.leverage AND i.direction=m.direction' +
  " WHERE m.enabled=true AND m.fidelity='EXACT'";

export function verifiedCandidates(rows: unknown[]): VerifiedCandidate[] {
  return rows as VerifiedCandidate[];
}
