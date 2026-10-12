import "server-only";
import Decimal from "decimal.js";
import { sql } from "@/lib/db";
import { getMarketDataProvider, type RejectedQuote } from "@/lib/market-data";
import { assessFreshness } from "@/domain/market-freshness";
import { runBounded } from "@/lib/work-pool";
import { assessQuote } from "@/domain/quote-plausibility";

/** MARKET_MAX_QUOTE_MOVE as an exact decimal; anything unset, malformed or non-positive uses the default. */
function configuredMaxMove(): Decimal | undefined {
  try {
    const value = new Decimal(String(process.env.MARKET_MAX_QUOTE_MOVE ?? "").trim());
    return value.isFinite() && value.gt(0) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Remember the newest refused quote for a line; an older rejection never replaces a newer one. */
async function recordRejection(tradingLineId: string, rejected: RejectedQuote) {
  await sql.unsafe(
    "INSERT INTO market_data_rejections (trading_line_id,observed_at,price,currency,provider,reason) VALUES ($1,$2,$3,$4,$5,$6) " +
    "ON CONFLICT (trading_line_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,price=EXCLUDED.price,currency=EXCLUDED.currency," +
    "provider=EXCLUDED.provider,reason=EXCLUDED.reason,rejected_at=now() WHERE market_data_rejections.observed_at<=EXCLUDED.observed_at",
    [tradingLineId, rejected.observedAt, rejected.price, rejected.currency, rejected.provider, rejected.code]
  );
}

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
          const symbol = String(line.provider_symbol);
          const detailed = provider.currentPriceDetailed
            ? await provider.currentPriceDetailed(symbol)
            : { observation: await provider.currentPrice(symbol), rejected: undefined };
          const observation = detailed.observation;
          if (!observation) {
            if (detailed.rejected) {
              // Refused as implausible by the provider layer (e.g. an unrecorded split): remember it so
              // calculations fail closed instead of falling back to the older, different-share-count price.
              await recordRejection(String(line.id), detailed.rejected);
              failed += 1;
              failures.push({ tradingLineId: String(line.id), code: detailed.rejected.code });
              return;
            }
            failed += 1;
            failures.push({ tradingLineId: String(line.id), code: "NO_QUOTE" });
            return;
          }
          if (assessFreshness(observation.observedAt, new Date()) !== "CURRENT") {
            failed += 1;
            failures.push({ tradingLineId: String(line.id), code: "STALE_OR_INVALID_QUOTE" });
            return;
          }
          if (observation.currency !== String(line.currency).toUpperCase()) {
            failed += 1;
            failures.push({ tradingLineId: String(line.id), code: "CURRENCY_MISMATCH" });
            return;
          }
          // The reference is the previous accepted quote, except that one older than a recorded stock
          // split (SPLIT ledger event, not reversed) describes a different share count and is no
          // reference for the post-split price.
          const previous = await sql.unsafe(
            "SELECT m.price,m.observed_at FROM market_data_observations m WHERE m.trading_line_id=$1 AND m.observed_at<$2 " +
            "AND NOT EXISTS (SELECT 1 FROM ledger_events s JOIN trading_lines t ON t.id=m.trading_line_id " +
            "WHERE s.instrument_id=t.instrument_id AND s.event_type='SPLIT' AND s.occurred_at>m.observed_at " +
            "AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=s.id)) " +
            "ORDER BY m.observed_at DESC LIMIT 1",
            [line.id, observation.observedAt]
          );
          const assessment = assessQuote(
            observation.price,
            previous[0] ? { price: String(previous[0].price), observedAt: new Date(previous[0].observed_at) } : null,
            new Date(),
            configuredMaxMove()
          );
          if (!assessment.ok) {
            if (assessment.code === "IMPLAUSIBLE_MOVE") {
              await recordRejection(String(line.id), {
                code: "IMPLAUSIBLE_MOVE", price: observation.price, currency: observation.currency,
                observedAt: observation.observedAt, provider: observation.provider
              });
            }
            failed += 1;
            failures.push({ tradingLineId: String(line.id), code: assessment.code });
            return;
          }
          await sql.unsafe(
            "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,$2,$3,$4,$5,'CURRENT') ON CONFLICT (trading_line_id,observed_at,provider) DO NOTHING",
            [line.id, observation.observedAt, observation.price, observation.currency, observation.provider]
          );
          // An accepted quote at least as new as a recorded rejection supersedes it.
          await sql.unsafe(
            "DELETE FROM market_data_rejections WHERE trading_line_id=$1 AND observed_at<=$2",
            [line.id, observation.observedAt]
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
