import "server-only";
import Decimal from "decimal.js";
import { sql } from "@/lib/db";
import { getMarketDataProvider } from "@/lib/market-data";
import { classifyFreshness } from "@/domain/market-freshness";
import { runBounded } from "@/lib/work-pool";
import { assessQuote } from "@/domain/quote-plausibility";

// A newer rejected observation must supersede cached accepted market data for action sizing.
async function markRejected(lineId:string, observation:{observedAt:Date;price:string;currency:string;provider:string},reason:string){
  await sql.unsafe(
    "INSERT INTO market_data_rejections (trading_line_id,observed_at,price,currency,provider,reason) VALUES ($1,$2,$3,$4,$5,$6) "+
    "ON CONFLICT (trading_line_id) DO UPDATE SET observed_at=EXCLUDED.observed_at,price=EXCLUDED.price,currency=EXCLUDED.currency,"+
    "provider=EXCLUDED.provider,reason=EXCLUDED.reason,rejected_at=now() WHERE market_data_rejections.observed_at<=EXCLUDED.observed_at",
    [lineId,observation.observedAt,observation.price,observation.currency,observation.provider,reason]
  );
}
function maxMove():Decimal|undefined{
  try{const n=new Decimal(String(process.env.MARKET_MAX_QUOTE_MOVE??""));
    return n.isFinite()&&n.gt(0)?n:undefined;
  }catch{return undefined;}
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
      // Least recently attempted first (never-attempted lines lead). Every attempt is stamped, so a
      // deadline-cut run resumes with the lines it did not reach and a symbol that keeps failing rotates
      // to the back instead of holding a slot ahead of healthy ones. The predicates are EXISTS-only, so
      // each trading line appears once without DISTINCT.
      "SELECT tl.id,tl.provider_symbol,tl.currency FROM trading_lines tl " +
      "WHERE tl.provider_symbol IS NOT NULL AND tl.effective_from<=current_date AND (tl.effective_to IS NULL OR tl.effective_to>=current_date) " +
      "AND (EXISTS (SELECT 1 FROM ledger_events l JOIN strategy_instances si ON si.id=l.strategy_instance_id WHERE l.instrument_id=tl.instrument_id AND si.status='ACTIVE') " +
      "OR EXISTS (SELECT 1 FROM regional_instrument_mappings m WHERE m.trading_line_id=tl.id AND m.enabled=true AND m.effective_from<=current_date AND (m.effective_to IS NULL OR m.effective_to>=current_date))) " +
      "ORDER BY tl.quote_attempted_at ASC NULLS FIRST,tl.id"
    );

    const pool = await runBounded(
      lines,
      { concurrency: options.concurrency ?? 5, shouldStop: () => options.deadline != null && Date.now() >= options.deadline },
      async (line) => {
        try {
          await sql.unsafe("UPDATE trading_lines SET quote_attempted_at=now() WHERE id=$1", [line.id]);
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
            "SELECT price,observed_at FROM market_data_observations WHERE trading_line_id=$1 ORDER BY observed_at DESC LIMIT 1",
            [line.id]
          );
          const last = previous[0];
          if(last && new Date(last.observed_at)>=observation.observedAt){
            failed+=1;
            failures.push({tradingLineId:String(line.id),code:"QUOTE_OUT_OF_ORDER"});
            return;
          }
          const unresolved = await sql.unsafe("SELECT observed_at FROM market_data_rejections WHERE trading_line_id=$1",[line.id]);
          // Do not let an unresolved erroneous quote become acceptable merely by waiting seven days.
          const assessment = assessQuote(observation.price,
            last?{price:String(last.price),observedAt:new Date(last.observed_at)}:null,
            new Date(),maxMove(),{ignoreReferenceAge:unresolved.length>0});
          if (!assessment.ok) {
            await markRejected(String(line.id),observation,assessment.code);
            failed += 1;
            failures.push({ tradingLineId: String(line.id), code: assessment.code });
            return;
          }
          await sql.unsafe(
            "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,$2,$3,$4,$5,'CURRENT') ON CONFLICT (trading_line_id,observed_at,provider) DO NOTHING",
            [line.id, observation.observedAt, observation.price, observation.currency, observation.provider]
          );
          await sql.unsafe("DELETE FROM market_data_rejections WHERE trading_line_id=$1 AND observed_at<=$2",
            [line.id,observation.observedAt]);
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
