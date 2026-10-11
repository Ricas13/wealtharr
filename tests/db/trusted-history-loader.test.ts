import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { loadTrustedHistory } from "@/lib/trusted-history-loader";

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;
const NOW = new Date("2026-10-09T12:00:00Z");

describe.skipIf(!url)("trusted history loader", () => {
  const run = Math.random().toString(36).slice(2, 8).toUpperCase();
  const lineIds: string[] = [];
  const instrumentIds: string[] = [];
  const exposure = "GOLD";

  async function line(ticker: string, currency: string, instrumentId: string) {
    const [l] = await sql!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE',$3,'Europe/London','2020-01-01') RETURNING id", [instrumentId, ticker, currency]);
    lineIds.push(String(l.id));
    return String(l.id);
  }
  async function fill(lineId: string, licensed: boolean) {
    for (let d = 0; d < 45; d += 1) {
      const day = new Date(NOW.getTime() - d * 86_400_000);
      if ([0, 6].includes(day.getUTCDay())) continue;
      await sql!.unsafe("INSERT INTO price_history (trading_line_id,trading_day,adjusted_close,currency,provider,licensed,adjustment_verified) VALUES ($1,$2,$3,'GBP','test',$4,true)", [lineId, day.toISOString().slice(0, 10), 100 + d, licensed]);
    }
  }
  async function instrument(isin: string) {
    const [i] = await sql!.unsafe("INSERT INTO instruments (isin,name,economic_exposure) VALUES ($1,$2,$3) RETURNING id", [isin, "History test " + run, exposure]);
    instrumentIds.push(String(i.id));
    return String(i.id);
  }

  beforeAll(async () => {
    // Clear any leftovers from other runs so the single-line rule is deterministic for GOLD.
    await sql!.unsafe("DELETE FROM price_history WHERE trading_line_id IN (SELECT tl.id FROM trading_lines tl JOIN instruments i ON i.id=tl.instrument_id WHERE i.economic_exposure=$1)", [exposure]);
  });
  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe("DELETE FROM instruments WHERE id = ANY($1::uuid[])", [instrumentIds]);
    await sql.end();
  });

  it("returns a validated series for one licensed line, and nothing for unlicensed data", async () => {
    const licensedInstrument = await instrument("GB" + run.padEnd(10, "0").slice(0, 10));
    const id = await line("HIST" + run, "GBP", licensedInstrument);
    await fill(id, false);
    expect(await loadTrustedHistory([exposure], "GBP", 1, NOW)).toEqual([]);
    await sql!.unsafe("UPDATE price_history SET licensed=true WHERE trading_line_id=$1", [id]);
    const series = await loadTrustedHistory([exposure], "GBP", 1, NOW);
    expect(series).toHaveLength(1);
    expect(series[0].exposure).toBe(exposure);
    expect(series[0].points.length).toBeGreaterThan(20);
    expect(await loadTrustedHistory([exposure], "USD", 1, NOW)).toEqual([]);
  });

  it("quarantines legacy licensed bars until independently revalidated as adjusted",async()=>{
    const first=lineIds[0];
    await sql!.unsafe("UPDATE price_history SET adjustment_verified=false WHERE trading_line_id=$1",[first]);
    expect(await loadTrustedHistory([exposure],"GBP",1,NOW)).toEqual([]);
    await sql!.unsafe("UPDATE price_history SET adjustment_verified=true WHERE trading_line_id=$1",[first]);
    expect((await loadTrustedHistory([exposure],"GBP",1,NOW)).length).toBe(1);
  });

  it("fails closed when two lines compete for the same exposure and currency", async () => {
    const other = await instrument("XS" + run.padEnd(10, "1").slice(0, 10));
    const second = await line("HISTB" + run, "GBP", other);
    await fill(second, true);
    expect(await loadTrustedHistory([exposure], "GBP", 1, NOW)).toEqual([]);
  });
});
