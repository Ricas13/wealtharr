import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

// Real database, fake provider. The refresh serves the least recently attempted trading lines first
// and stamps every attempt (also the failed ones), so a deadline-cut run resumes where it stopped and a
// symbol that always fails cannot sit at the head of the queue.
const state = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/market-data", () => ({
  getMarketDataProvider: () => ({
    name: "fake",
    configured: true,
    currentPrice: async (symbol: string) => {
      state.calls.push(symbol);
      return null;
    }
  })
}));

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;

describe.skipIf(!url)("market data refresh fairness", () => {
  const run = Math.random().toString(36).slice(2, 10);
  const instrumentIds: string[] = [];
  const lineIds: string[] = [];
  const symbols = { never: "FN" + run, stale: "FS" + run, recent: "FR" + run };

  beforeAll(async () => {
    const [instrument] = await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'US_EQUITY_3X_LONG',3,'USD') RETURNING id", [`Fairness ${run}`]);
    instrumentIds.push(String(instrument.id));
    for (const [label, symbol] of Object.entries(symbols)) {
      const [line] = await sql!.unsafe(
        "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from,quote_attempted_at) " +
        "VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01',CASE $3::text WHEN 'stale' THEN now()-interval '3 hours' WHEN 'recent' THEN now()-interval '1 hour' ELSE NULL END) RETURNING id",
        [instrument.id, symbol, label]
      );
      lineIds.push(String(line.id));
      await sql!.unsafe(
        "INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ('US_EQUITY_3X_LONG',3,'US','TAXABLE',$1,'EXACT','2020-01-01',true)",
        [line.id]
      );
    }
  });
  afterAll(async () => {
    if (!sql) return;
    for (const id of lineIds) await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1", [id]);
    for (const id of lineIds) await sql.unsafe("DELETE FROM trading_lines WHERE id=$1", [id]);
    for (const id of instrumentIds) await sql.unsafe("DELETE FROM instruments WHERE id=$1", [id]);
    await sql.end();
  });

  it("serves never-attempted lines first, then the oldest attempt, and stamps every attempt", async () => {
    const { refreshMarketData } = await import("@/lib/market-data-worker");
    const startedAt = Date.now();
    state.calls.length = 0;
    await refreshMarketData({ concurrency: 1 });

    const ours = state.calls.filter((symbol) => Object.values(symbols).includes(symbol));
    expect(ours).toEqual([symbols.never, symbols.stale, symbols.recent]);

    // Every attempt was stamped although every quote failed (no quote available).
    const stamps = await sql!.unsafe("SELECT quote_attempted_at FROM trading_lines WHERE id=ANY($1::uuid[])", [lineIds]);
    expect(stamps).toHaveLength(3);
    for (const row of stamps) expect(new Date(row.quote_attempted_at).getTime()).toBeGreaterThanOrEqual(startedAt - 2_000);

    // Next run: all three were just attempted, so the order among them is the order of that attempt.
    state.calls.length = 0;
    await refreshMarketData({ concurrency: 1 });
    expect(state.calls.filter((symbol) => Object.values(symbols).includes(symbol))).toEqual(ours);
  });

  it("resumes with the lines it did not reach when the deadline cut the previous run", async () => {
    const { refreshMarketData } = await import("@/lib/market-data-worker");
    await sql!.unsafe("UPDATE trading_lines SET quote_attempted_at=CASE ticker WHEN $1 THEN now()-interval '5 hours' WHEN $2 THEN now()-interval '4 hours' ELSE now() END WHERE id=ANY($3::uuid[])", [symbols.recent, symbols.never, lineIds]);
    state.calls.length = 0;
    // A deadline that has already passed: nothing is attempted, nothing is stamped.
    const cut = await refreshMarketData({ concurrency: 1, deadline: Date.now() - 1 });
    expect(cut.skipped).toBeGreaterThan(0);
    expect(state.calls.filter((symbol) => Object.values(symbols).includes(symbol))).toEqual([]);

    await refreshMarketData({ concurrency: 1 });
    expect(state.calls.filter((symbol) => Object.values(symbols).includes(symbol))).toEqual([symbols.recent, symbols.never, symbols.stale]);
  });
});
