import "server-only";
import { sql } from "@/lib/db";
import { getMarketDataProvider } from "@/lib/market-data";
import { classifyFreshness } from "@/domain/market-freshness";
import { runBounded } from "@/lib/work-pool";
import { assessQuote } from "@/domain/quote-plausibility";

// `deadline` (epoch ms) stops new lookups once reached; lines not refreshed are reported as skipped
// so a slow provider shows up as a degraded run instead of silently eating the whole worker.
export async function refreshMarketData(options: { deadline?: number; concurrency?: number } = {}) {
  const provider = getMarketDataProvider();
  const runRows = await sql.unsafe(
    "INSERT INTO worker_runs (worker_key,status,details) VALUES ('market-data-refresh','RUNNING',$1::jsonb) RETURNING id",
    [JSON.stringify({ provider: provider.name, configured: provider.configured })]
  );
  const runId = String(runRows[0].id);

  if (!provider.configured) {
    await sql.unsafe(
      "UPDATE worker_runs SET status='SKIPPED',finished_at=now(),details=$1::jsonb WHERE id=$2",
      [JSON.stringify({ provider: provider.name, configured: false }), runId]
    );
    return { provider: provider.name, configured: false, refreshed: 0, failed: 0, skipped: 0 };
  }

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: Array<{ tradingLineId: string; code: string }> = [];

  try {
    const lines = await sql.unsafe(
      "SELECT DISTINCT tl.id,tl.provider_symbol,tl.currency FROM trading_lines tl " +
      "WHERE tl.provider_symbol IS NOT NULL AND tl.effective_from<=current_date AND (tl.effective_to IS NULL OR tl.effective_to>=current_date) " +
      "AND (EXISTS (SELECT 1 FROM ledger_events l JOIN strategy_instances si ON si.id=l.strategy_instance_id WHERE l.instrument_id=tl.instrument_id AND si.status='ACTIVE') " +
      "OR EXISTS (SELECT 1 FROM regional_instrument_mappings m WHERE m.trading_line_id=tl.id AND m.enabled=true AND m.effective_from<=current_date AND (m.effective_to IS NULL OR m.effective_to>=current_date)))"
    );

    const pool = await runBounded(
      lines,
      { concurrency: options.concurrency ?? 5, shouldStop: () => options.deadline != null && Date.now() >= options.deadline },
      async (line) => {
        try {
          const observation = await provider.currentPrice(String(line.provider_symbol));
          if (!observation) {
            failed += 1;
            failures.push({ tradingLineId: String(line.id), code: "NO_QUOTE" });
            return;
          }
          if (classifyFreshness(observation.observedAt) !== "CURRENT") {
            failed += 1;
            failures.push({ tradingLineId: String(line.id), code: "STALE_OR_INVALID_QUOTE" });
            return;
          }
          if (observation.currency !== String(line.currency).toUpperCase()) {
            failed += 1;
            failures.push({ tradingLineId: String(line.id), code: "CURRENCY_MISMATCH" });
            return;
          }
          const previous = await sql.unsafe(
            "SELECT price,observed_at FROM market_data_observations WHERE trading_line_id=$1 AND observed_at<$2 ORDER BY observed_at DESC LIMIT 1",
            [line.id, observation.observedAt]
          );
          const maxMove = Number(process.env.MARKET_MAX_QUOTE_MOVE);
          const assessment = assessQuote(
            Number(observation.price),
            previous[0] ? { price: Number(previous[0].price), observedAt: new Date(previous[0].observed_at) } : null,
            new Date(),
            Number.isFinite(maxMove) && maxMove > 0 ? maxMove : undefined
          );
          if (!assessment.ok) {
            failed += 1;
            failures.push({ tradingLineId: String(line.id), code: assessment.code });
            return;
          }
          await sql.unsafe(
            "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,$2,$3,$4,$5,'CURRENT') ON CONFLICT (trading_line_id,observed_at,provider) DO NOTHING",
            [line.id, observation.observedAt, observation.price, observation.currency, observation.provider]
          );
          refreshed += 1;
        } catch {
          failed += 1;
          // Provider exception messages can contain URLs or credentials.
          failures.push({ tradingLineId: String(line.id), code: "PROVIDER_REQUEST_FAILED" });
        }
      }
    );
    skipped = pool.deferred;

    await sql.unsafe(
      "UPDATE worker_runs SET status=$1,finished_at=now(),details=$2::jsonb WHERE id=$3",
      [failed || skipped ? "PARTIAL" : "SUCCESS", JSON.stringify({ provider: provider.name, configured: true, refreshed, failed, skipped, failures: failures.slice(0, 50) }), runId]
    );
    return { provider: provider.name, configured: true, refreshed, failed, skipped };
  } catch (error) {
    await sql.unsafe(
      "UPDATE worker_runs SET status='FAILED',finished_at=now(),details=$1::jsonb WHERE id=$2",
      [JSON.stringify({ provider: provider.name, error: "MARKET_DATA_WORKER_FAILED" }), runId]
    );
    throw error;
  }
}
