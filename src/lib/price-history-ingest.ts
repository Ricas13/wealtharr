import "server-only";
import { sql } from "@/lib/db";
import { getMarketDataProvider, type MarketDataProvider } from "@/lib/market-data";
import { acceptHistoryObservation } from "@/domain/trusted-history";
import { runBounded } from "@/lib/work-pool";

const LOOKBACK_DAYS = 450;
const MAX_DAYS_PER_LINE_PER_RUN = 40;

/**
 * Fills daily adjusted closes for the trading lines of momentum research strategies. Off unless the
 * operator has confirmed, in Admin > Settings, that the data service returns adjusted closes and that
 * the licence allows storing them (MARKET_DATA_HISTORY_ADJUSTED_LICENSED). Each returned daily
 * price must also explicitly declare corporateActionsAdjusted=true; plain closes are rejected.
 * Newest missing days are
 * fetched first so the series becomes fresh before the older backfill completes; each run is capped
 * so a long backfill spreads over several hourly runs.
 */
export async function ingestPriceHistory(options: { deadline?: number; concurrency?: number; provider?: MarketDataProvider } = {}) {
  if (process.env.MARKET_DATA_HISTORY_ADJUSTED_LICENSED !== "true") return { status: "OFF" as const, stored: 0, rejected: 0 };
  const provider = options.provider ?? getMarketDataProvider();
  if (!provider.configured) return { status: "UNCONFIGURED" as const, stored: 0, rejected: 0 };

  const lines = await sql.unsafe(
    "SELECT DISTINCT tl.id,tl.provider_symbol,tl.currency FROM trading_lines tl JOIN instruments i ON i.id=tl.instrument_id " +
    "WHERE tl.provider_symbol IS NOT NULL AND tl.effective_from<=current_date AND (tl.effective_to IS NULL OR tl.effective_to>=current_date) " +
    "AND i.economic_exposure IN (" +
    " SELECT e FROM strategy_versions v, jsonb_array_elements_text(v.config->'riskAssets') e WHERE v.engine_key='MOMENTUM_ROTATION' AND jsonb_typeof(v.config->'riskAssets')='array'" +
    " UNION SELECT v.config->>'defensiveAsset' FROM strategy_versions v WHERE v.engine_key='MOMENTUM_ROTATION' AND v.config ? 'defensiveAsset')"
  );
  let stored = 0;
  let rejected = 0;
  await runBounded(
    lines,
    { concurrency: options.concurrency ?? 3, shouldStop: () => options.deadline != null && Date.now() >= options.deadline },
    async (line) => {
      const days = await sql.unsafe(
        "SELECT to_char(d::date,'YYYY-MM-DD') AS day FROM generate_series(current_date-$1::int, current_date-1, interval '1 day') d " +
        "WHERE extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM price_history h WHERE h.trading_line_id=$2 AND h.trading_day=d::date AND h.licensed=true AND h.adjustment_verified=true) " +
        "ORDER BY d DESC LIMIT $3",
        [LOOKBACK_DAYS, line.id, MAX_DAYS_PER_LINE_PER_RUN]
      );
      for (const row of days) {
        if (options.deadline != null && Date.now() >= options.deadline) return;
        const day = String(row.day);
        try {
          const observation = await provider.historicalPrice(String(line.provider_symbol), new Date(day + "T21:00:00.000Z"));
          if (!acceptHistoryObservation(observation, day, String(line.currency))) { rejected += 1; continue; }
          await sql.unsafe(
            "INSERT INTO price_history (trading_line_id,trading_day,adjusted_close,currency,provider,licensed,adjustment_verified) VALUES ($1,$2,$3,$4,$5,true,true) "+ 
            "ON CONFLICT (trading_line_id,trading_day,provider) DO UPDATE SET "+ 
            "adjusted_close=EXCLUDED.adjusted_close,currency=EXCLUDED.currency,licensed=true,adjustment_verified=true,ingested_at=now()",
            [line.id, day, observation!.price, observation!.currency.toUpperCase(), observation!.provider]
          );
          stored += 1;
        } catch { rejected += 1; }
      }
    }
  );
  return { status: "RAN" as const, stored, rejected };
}
