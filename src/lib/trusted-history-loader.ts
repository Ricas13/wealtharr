import "server-only";
import { sql } from "@/lib/db";
import { buildTrustedSeries, type HistoryRow } from "@/domain/trusted-history";
import type { TrustedHistoricalSeries } from "@/domain/strategy/types";

/**
 * Licensed daily history for each exposure in the base currency. An exposure with no history, more
 * than one candidate trading line, or a series that fails validation is simply left out; the engine
 * then reports DATA_REQUIRED for it rather than computing a signal from partial data.
 */
export async function loadTrustedHistory(exposures: readonly string[], currency: string, lookbackMonths: number, now = new Date()): Promise<TrustedHistoricalSeries[]> {
  const result: TrustedHistoricalSeries[] = [];
  for (const exposure of exposures) {
    const lines = await sql.unsafe(
      "SELECT DISTINCT tl.id FROM trading_lines tl JOIN instruments i ON i.id=tl.instrument_id JOIN price_history h ON h.trading_line_id=tl.id WHERE i.economic_exposure=$1 AND upper(tl.currency)=upper($2)",
      [exposure, currency]
    );
    if (lines.length !== 1) continue;
    const rows = await sql.unsafe(
      "SELECT to_char(trading_day,'YYYY-MM-DD') AS trading_day,adjusted_close::text AS adjusted_close,currency,provider,licensed,adjustment_verified FROM price_history WHERE trading_line_id=$1 AND trading_day>=($2::date - $3::int) ORDER BY trading_day",
      [lines[0].id, now.toISOString().slice(0, 10), lookbackMonths * 31 + 14]
    );
    const history: HistoryRow[] = rows.map((r) => ({ tradingDay: String(r.trading_day), adjustedClose: String(r.adjusted_close), currency: String(r.currency), provider: String(r.provider), licensed: Boolean(r.licensed), adjustmentVerified: r.adjustment_verified===true }));
    const series = buildTrustedSeries(exposure, history, { now, currency, minSpanDays: lookbackMonths * 28, maxAgeDays: 5 });
    if (series) result.push(series);
  }
  return result;
}
