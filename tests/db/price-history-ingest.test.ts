import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { ingestPriceHistory } from "@/lib/price-history-ingest";
import type { MarketDataProvider } from "@/lib/market-data";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;

describe.skipIf(!url)("price history ingest", () => {
  const run = Math.random().toString(36).slice(2, 8).toUpperCase();
  const exposure = "INGEST_" + run;
  let lineId = "";
  let instrumentId = "";
  let definitionId = "";
  const calls: string[] = [];
  const provider = (overrides: Partial<Record<string, object>> = {}): MarketDataProvider => ({
    name: "fake", configured: true,
    currentPrice: async () => null,
    historicalPrice: async (_symbol, at) => {
      calls.push(at.toISOString());
      const day = at.toISOString().slice(0, 10);
      return { price: "101", currency: "GBP", observedAt: at, provider: "fake", granularity: "DAILY_BAR", priceKind: "CLOSE", corporateActionsAdjusted: true, ...(overrides[day] ?? {}) } as never;
    }
  });
  const count = async () => Number((await sql!.unsafe("SELECT count(*)::int AS n FROM price_history WHERE trading_line_id=$1", [lineId]))[0].n);

  beforeAll(async () => {
    const [d] = await sql!.unsafe("INSERT INTO strategy_definitions (key,name,family,engine,enabled) VALUES ($1,'Ingest test','MOMENTUM','MOMENTUM_ROTATION',false) RETURNING id", ["ingest-" + run]);
    definitionId = String(d.id);
    await sql!.unsafe("INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config) VALUES ($1,'1.0','2031-01-01','MOMENTUM_ROTATION','DRAFT','[]'::jsonb,$2::text::jsonb)", [definitionId, JSON.stringify({ riskAssets: [exposure, "OTHER_" + run], defensiveAsset: "DEF_" + run, lookbackMonths: 6, reviewFrequency: "MONTHLY", minimumAbsoluteReturn: "0" })]);
    const [i] = await sql!.unsafe("INSERT INTO instruments (isin,name,economic_exposure) VALUES ($1,'Ingest test',$2) RETURNING id", ["IN" + run.padEnd(10, "0").slice(0, 10), exposure]);
    instrumentId = String(i.id);
    const [l] = await sql!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London',$3,'2020-01-01') RETURNING id", [instrumentId, "ING" + run, "ING" + run]);
    lineId = String(l.id);
  });
  afterAll(async () => {
    if (!sql) return;
    delete process.env.MARKET_DATA_HISTORY_ADJUSTED_LICENSED;
    await sql.unsafe("SET app.allow_published_edit = 'on'");
    await sql.unsafe("DELETE FROM strategy_versions WHERE strategy_definition_id=$1", [definitionId]);
    await sql.unsafe("DELETE FROM strategy_definitions WHERE id=$1", [definitionId]);
    await sql.unsafe("DELETE FROM instruments WHERE id=$1", [instrumentId]);
    await sql.end();
  });

  it("does nothing until the operator confirms the licence and adjusted prices", async () => {
    delete process.env.MARKET_DATA_HISTORY_ADJUSTED_LICENSED;
    expect((await ingestPriceHistory({ provider: provider() })).status).toBe("OFF");
    expect(await count()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("stores the newest missing weekdays, capped per run, flagged licensed", async () => {
    process.env.MARKET_DATA_HISTORY_ADJUSTED_LICENSED = "true";
    const result = await ingestPriceHistory({ provider: provider() });
    expect(result).toMatchObject({ status: "RAN", stored: 40, rejected: 0 });
    expect(await count()).toBe(40);
    const rows = await sql!.unsafe("SELECT licensed,adjustment_verified,provider,extract(isodow FROM trading_day)::int AS dow FROM price_history WHERE trading_line_id=$1", [lineId]);
    expect(rows.every((r) => r.licensed === true && r.adjustment_verified === true && r.provider === "fake" && r.dow < 6)).toBe(true);
    const newest = await sql!.unsafe("SELECT to_char(max(trading_day),'YYYY-MM-DD') AS d FROM price_history WHERE trading_line_id=$1", [lineId]);
    const expected = new Date();
    do expected.setUTCDate(expected.getUTCDate() - 1); while ([0, 6].includes(expected.getUTCDay()));
    expect(String(newest[0].d)).toBe(expected.toISOString().slice(0, 10));
  });

  it("rejects unadjusted closes despite operator licensing flag",async()=>{
    const before=await count();
    process.env.MARKET_DATA_HISTORY_ADJUSTED_LICENSED="true";
    const unadjustedProvider={
      ...provider(),historicalPrice:async (_symbol:string,at:Date)=>({
        price:"101",currency:"GBP",observedAt:at,provider:"fake",
        granularity:"DAILY_BAR" as const,priceKind:"CLOSE" as const,
        corporateActionsAdjusted:false
      })
    };
    const result=await ingestPriceHistory({provider:unadjustedProvider});
    expect(result.rejected).toBeGreaterThan(0);
    expect(await count()).toBe(before);
  });

  it("rejects non-close answers instead of storing them, and a rerun continues the backfill", async () => {
    const before = await count();
    const result = await ingestPriceHistory({ provider: { ...provider(), historicalPrice: async (_s, at) => ({ price: "5", currency: "GBP", observedAt: at, provider: "fake", granularity: "TRADE", priceKind: "LAST" }) as never } });
    expect(result.rejected).toBeGreaterThan(0);
    expect(result.stored).toBe(0);
    expect(await count()).toBe(before);
    expect((await ingestPriceHistory({ provider: provider() })).stored).toBe(40);
  });
});
