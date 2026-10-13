import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

// A real split halves the quoted price. The worker must accept that post-split quote ONLY when a
// recorded, unreversed SPLIT for the instrument explains it, and must otherwise keep rejecting it.
// Only the quote provider is faked; the worker, ledger and action service are the real code.
const feed = vi.hoisted(() => ({ prices: {} as Record<string, string> }));
vi.mock("@/lib/market-data", async (original) => {
  const real = await original<typeof import("@/lib/market-data")>();
  return { ...real, getMarketDataProvider: () => new real.MockMarketDataProvider(feed.prices) };
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 3, prepare: false }) : null;

type Fixture = { symbol: string; instrumentId: string; lineId: string };

describe.skipIf(!url)("split-explained quote recovery through the market worker", () => {
  const run = Math.random().toString(36).slice(2, 8);
  const users: string[] = [];
  const fixtures: Fixture[] = [];
  let counter = 0;

  // Several EXACT mappings for the same exposure/country/wrapper make market resolution ambiguous
  // (DATA_REQUIRED for unrelated reasons), so a finished case retires its mapping.
  afterEach(async () => {
    for (const f of fixtures) await sql!.unsafe("UPDATE regional_instrument_mappings SET enabled=false WHERE trading_line_id=$1", [f.lineId]);
  });
  beforeAll(() => {
    process.env.MARKET_DATA_PROVIDER = "mock";
  });
  afterAll(async () => {
    if (!sql) return;
    for (const userId of users) await sql.unsafe("DELETE FROM users WHERE id=$1", [userId]);
    for (const f of fixtures) {
      await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1", [f.lineId]);
      await sql.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1", [f.lineId]);
      await sql.unsafe("DELETE FROM market_data_rejections WHERE trading_line_id=$1", [f.lineId]);
      await sql.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1", [f.lineId]);
      await sql.unsafe("DELETE FROM trading_lines WHERE id=$1", [f.lineId]);
      await sql.unsafe("DELETE FROM instruments WHERE id=$1", [f.instrumentId]);
    }
    await sql.end();
  });

  // One instrument and quote line with an accepted pre-split price observed an hour ago.
  const makeLine = async (referencePrice: string): Promise<Fixture> => {
    counter += 1;
    const symbol = ("SPQ" + run + counter).toUpperCase();
    const instrumentId = String((await sql!.unsafe(
      "INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id", ["Split quote " + symbol]
    ))[0].id);
    const lineId = String((await sql!.unsafe(
      "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London',$3,'2020-01-01') RETURNING id",
      [instrumentId, symbol, symbol]
    ))[0].id);
    await sql!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ('NASDAQ_100_3X_LONG',3,'GB','ISA',$1,'EXACT','2020-01-01',true)", [lineId]);
    await sql!.unsafe(
      "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now()-interval '1 hour',$2,'GBP','split-fixture','CURRENT')",
      [lineId, referencePrice]
    );
    const fixture = { symbol, instrumentId, lineId };
    fixtures.push(fixture);
    return fixture;
  };
  // A user with one 9Sig strategy holding 10 units of the instrument bought before any split.
  const makeHolder = async (fixture: Fixture) => {
    counter += 1;
    const userId = String((await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`splitq-${run}-${counter}@example.test`]))[0].id);
    users.push(userId);
    const pro = await sql!.unsafe("SELECT id FROM plans WHERE slug='pro'");
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'ACTIVE','MONTHLY')", [userId, pro[0].id]);
    const accountId = String((await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'Split','ISA','GB','GBP') RETURNING id", [userId]))[0].id);
    const instance = await sql!.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,'Split' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id,strategy_version_id",
      [userId, accountId]
    );
    const instanceId = String(instance[0].id);
    await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')", [instanceId, accountId]);
    await sql!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)", [instanceId, instance[0].strategy_version_id]);
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance) VALUES ($1,$2,now()-interval '2 days','OPENING_CASH','GBP',4000,'USER_CONFIRMED')", [instanceId, accountId]);
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance) VALUES ($1,$2,now()-interval '2 days','OPENING_POSITION','GBP',0,$3,10,'USER_CONFIRMED')", [instanceId, accountId, fixture.instrumentId]);
    return { userId, accountId, instanceId };
  };
  // Records a split exactly as the splits route stores it (quantity delta, ratio metadata).
  const recordSplit = async (holder: { accountId: string; instanceId: string }, fixture: Fixture, to: number, from: number, delta: string) => {
    const row = await sql!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,fee_amount,provenance,confidence,metadata) VALUES ($1,$2,now(),'SPLIT','GBP',0,$3,$4,0,'USER_ENTERED','VERIFIED',$5::text::jsonb) RETURNING id",
      [holder.instanceId, holder.accountId, fixture.instrumentId, delta, JSON.stringify({ ratio: `${to}:${from}`, to, from })]
    );
    return String(row[0].id);
  };
  const reverseSplit = async (holder: { accountId: string; instanceId: string }, fixture: Fixture, eventId: string, delta: string) => {
    await sql!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,fee_amount,provenance,confidence,correction_of_event_id) VALUES ($1,$2,now(),'CORRECTION','GBP',0,$3,$4,0,'USER_CONFIRMED','VERIFIED',$5)",
      [holder.instanceId, holder.accountId, fixture.instrumentId, String(-Number(delta)), eventId]
    );
  };
  // Latest worker run details, attached to assertion messages so a CI failure shows why.
  const runInfo = async () =>
    JSON.stringify((await sql!.unsafe("SELECT details FROM worker_runs WHERE worker_key='market-data-refresh' ORDER BY started_at DESC LIMIT 1"))[0]?.details);
  const splitRows = async (f: Fixture) =>
    JSON.stringify(await sql!.unsafe("SELECT occurred_at,metadata FROM ledger_events WHERE instrument_id=$1 AND event_type='SPLIT'", [f.instrumentId]));
  const observations = async (f: Fixture) =>
    (await sql!.unsafe("SELECT price FROM market_data_observations WHERE trading_line_id=$1 ORDER BY observed_at", [f.lineId])).map((r) => Number(r.price));
  const rejection = async (f: Fixture) => sql!.unsafe("SELECT reason FROM market_data_rejections WHERE trading_line_id=$1", [f.lineId]);
  const marker = async (f: Fixture) =>
    (await sql!.unsafe("SELECT corporate_action_suspected_at,corporate_action_split_at FROM trading_lines WHERE id=$1", [f.lineId]))[0];
  const refresh = async () => (await import("@/lib/market-data-worker")).refreshMarketData();
  const decide = async (instanceId: string) => {
    const { calculateAction } = await import("@/lib/action-service");
    const result = await calculateAction(instanceId);
    return (await sql!.unsafe("SELECT action_type,instruction FROM actions WHERE id=$1", [result.actionId]))[0];
  };

  it("accepts the post-split quote once a 2:1 split is recorded, clears the rejection and resumes the action", async () => {
    const f = await makeLine("100");
    const holder = await makeHolder(f);
    feed.prices[f.symbol] = "50";

    // Before anyone records the split the halved price is still an implausible move.
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
    expect((await decide(holder.instanceId)).action_type).toBe("DATA_REQUIRED");

    // The holder records the split; the next refresh of the same quote is explained and accepted.
    await recordSplit(holder, f, 2, 1, "10");
    const result = await refresh();
    const why = async () => `run=${await runInfo()} splits=${await splitRows(f)}`;
    expect(result.refreshed, await why()).toBeGreaterThanOrEqual(1);
    expect(await observations(f), await why()).toEqual([100, 50]);
    expect(await rejection(f)).toHaveLength(0);
    expect((await marker(f)).corporate_action_split_at).not.toBeNull();
    const note = (await sql!.unsafe("SELECT details FROM worker_runs WHERE worker_key='market-data-refresh' ORDER BY started_at DESC LIMIT 1"))[0];
    expect(JSON.stringify(note.details)).toContain("SPLIT_EXPLAINED_QUOTE");

    // Value is continuous: 10 x 100 before, 20 x 50 after; the strategy calculates instead of stopping.
    const units = Number((await sql!.unsafe("SELECT sum(quantity) AS q FROM ledger_events WHERE strategy_instance_id=$1 AND instrument_id=$2", [holder.instanceId, f.instrumentId]))[0].q);
    expect(units * 50).toBe(10 * 100);
    const action = await decide(holder.instanceId);
    expect(String(action.action_type)).not.toBe("DATA_REQUIRED");
    expect(String(action.instruction)).not.toMatch(/rejected|stock split was recorded after/i);
  });

  it("fails closed for a second strategy that holds pre-split units but did not record the split", async () => {
    const f = await makeLine("100");
    const recorder = await makeHolder(f);
    const bystander = await makeHolder(f);
    feed.prices[f.symbol] = "50";
    await recordSplit(recorder, f, 2, 1, "10");
    await refresh();
    expect(await observations(f), `run=${await runInfo()} splits=${await splitRows(f)}`).toEqual([100, 50]);

    const recorderAction = await decide(recorder.instanceId);
    expect(String(recorderAction.action_type), String(recorderAction.instruction)).not.toBe("DATA_REQUIRED");
    const blocked = await decide(bystander.instanceId);
    expect(blocked.action_type).toBe("DATA_REQUIRED");
    expect(String(blocked.instruction)).toContain("has not recorded it");
  });

  it("keeps rejecting the same move when no split is recorded", async () => {
    const f = await makeLine("100");
    await makeHolder(f);
    feed.prices[f.symbol] = "50";
    await refresh();
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect(await rejection(f)).toHaveLength(1);
    expect((await marker(f)).corporate_action_split_at).toBeNull();
  });

  it("accepts a 1:10 reverse split quote once recorded", async () => {
    const f = await makeLine("5");
    const holder = await makeHolder(f);
    feed.prices[f.symbol] = "50";
    await recordSplit(holder, f, 1, 10, "-9");
    await refresh();
    expect(await observations(f), `run=${await runInfo()} splits=${await splitRows(f)}`).toEqual([5, 50]);
    expect(await rejection(f)).toHaveLength(0);
  });

  it("does not let a reversed split explain the move", async () => {
    const f = await makeLine("100");
    const holder = await makeHolder(f);
    feed.prices[f.symbol] = "50";
    const id = await recordSplit(holder, f, 2, 1, "10");
    await reverseSplit(holder, f, id, "10");
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  it("does not let a split with a different ratio, or a x100 pence error, ride on a recorded split", async () => {
    const f = await makeLine("100");
    const holder = await makeHolder(f);
    await recordSplit(holder, f, 3, 1, "20");
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100]);
    feed.prices[f.symbol] = "10000";
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });
});
