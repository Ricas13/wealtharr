import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

// A real split halves the quoted price. The worker accepts that post-split quote ONLY when an
// administrator-confirmed corporate action explains it. A split a user records in their own ledger
// restates that strategy's units and never explains a price. Only the quote provider is faked.
const feed = vi.hoisted(() => ({ prices: {} as Record<string, string> }));
vi.mock("@/lib/market-data", async (original) => {
  const real = await original<typeof import("@/lib/market-data")>();
  return { ...real, getMarketDataProvider: () => new real.MockMarketDataProvider(feed.prices) };
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 3, prepare: false }) : null;

type Fixture = { symbol: string; instrumentId: string; lineId: string };
type Holder = { userId: string; accountId: string; instanceId: string };

describe.skipIf(!url)("corporate-action-explained quote recovery through the market worker", () => {
  const run = Math.random().toString(36).slice(2, 8);
  const users: string[] = [];
  const fixtures: Fixture[] = [];
  let counter = 0;

  beforeAll(() => {
    process.env.MARKET_DATA_PROVIDER = "mock";
  });
  // Several EXACT mappings for the same exposure/country/wrapper make market resolution ambiguous,
  // so a finished case retires its mappings.
  afterEach(async () => {
    for (const f of fixtures) await sql!.unsafe("UPDATE regional_instrument_mappings SET enabled=false WHERE trading_line_id=$1", [f.lineId]);
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
    }
    for (const instrumentId of new Set(fixtures.map((f) => f.instrumentId))) {
      await sql.unsafe("DELETE FROM corporate_actions WHERE instrument_id=$1", [instrumentId]);
      await sql.unsafe("DELETE FROM instruments WHERE id=$1", [instrumentId]);
    }
    await sql.end();
  });

  // An instrument with one quote line whose accepted reference was observed two days ago, so a
  // corporate action effective today is strictly after the reference date.
  const makeInstrument = async () => {
    counter += 1;
    return String((await sql!.unsafe(
      "INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id", [`Corp action ${run}${counter}`]
    ))[0].id);
  };
  const makeLine = async (instrumentId: string, referencePrice: string, withMapping = true): Promise<Fixture> => {
    counter += 1;
    const symbol = ("CAQ" + run + counter).toUpperCase();
    const lineId = String((await sql!.unsafe(
      "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,$3,'GBP','Europe/London',$4,'2020-01-01') RETURNING id",
      [instrumentId, symbol, "X" + counter, symbol]
    ))[0].id);
    if (withMapping) {
      await sql!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ('NASDAQ_100_3X_LONG',3,'GB','ISA',$1,'EXACT','2020-01-01',true)", [lineId]);
    }
    await sql!.unsafe(
      "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now()-interval '2 days',$2,'GBP','ca-fixture','CURRENT')",
      [lineId, referencePrice]
    );
    const fixture = { symbol, instrumentId, lineId };
    fixtures.push(fixture);
    return fixture;
  };
  const makeFixture = async (referencePrice: string) => makeLine(await makeInstrument(), referencePrice);

  // A user with one 9Sig strategy holding 10 units, opened `openedDaysAgo` days ago (0 = today).
  const makeHolder = async (fixture: Fixture, openedDaysAgo = 3): Promise<Holder> => {
    counter += 1;
    const userId = String((await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id", [`ca-${run}-${counter}@example.test`]))[0].id);
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
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance) VALUES ($1,$2,now()-($3::int*interval '1 day')-interval '1 minute','OPENING_CASH','GBP',4000,'USER_CONFIRMED')", [instanceId, accountId, openedDaysAgo]);
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance) VALUES ($1,$2,now()-($3::int*interval '1 day'),'OPENING_POSITION','GBP',0,$4,10,'USER_CONFIRMED')", [instanceId, accountId, openedDaysAgo, fixture.instrumentId]);
    return { userId, accountId, instanceId };
  };
  // A user's own split record, as the splits route stores it (quantity delta, ratio metadata).
  const recordUserSplit = async (holder: Holder, instrumentId: string, to: number, from: number, delta: string) => {
    await sql!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,fee_amount,provenance,confidence,metadata) VALUES ($1,$2,now(),'SPLIT','GBP',0,$3,$4,0,'USER_ENTERED','VERIFIED',$5::text::jsonb)",
      [holder.instanceId, holder.accountId, instrumentId, delta, JSON.stringify({ ratio: `${to}:${from}`, to, from })]
    );
  };
  // An administrator-confirmed split effective today (UTC), exactly as the admin route stores it.
  const confirmAction = async (instrumentId: string, to: number, from: number) =>
    String((await sql!.unsafe(
      "INSERT INTO corporate_actions (instrument_id,kind,ratio_to,ratio_from,effective_date,evidence) VALUES ($1,'SPLIT',$2,$3,(now() AT TIME ZONE 'UTC')::date,$4::text::jsonb) RETURNING id",
      [instrumentId, to, from, JSON.stringify({ sourceUrl: "https://example.test/split", retrievedAt: "2026-10-14", note: "Issuer notice read and compared" })]
    ))[0].id);

  const observations = async (f: Fixture) =>
    (await sql!.unsafe("SELECT price FROM market_data_observations WHERE trading_line_id=$1 ORDER BY observed_at", [f.lineId])).map((r) => Number(r.price));
  const rejection = async (f: Fixture) => sql!.unsafe("SELECT reason FROM market_data_rejections WHERE trading_line_id=$1", [f.lineId]);
  const runInfo = async () =>
    JSON.stringify((await sql!.unsafe("SELECT details FROM worker_runs WHERE worker_key='market-data-refresh' ORDER BY started_at DESC LIMIT 1"))[0]?.details);
  const refresh = async () => (await import("@/lib/market-data-worker")).refreshMarketData();
  const decide = async (instanceId: string) => {
    const { calculateAction } = await import("@/lib/action-service");
    const result = await calculateAction(instanceId);
    return (await sql!.unsafe("SELECT action_type,instruction FROM actions WHERE id=$1", [result.actionId]))[0];
  };
  const resumed = async (instanceId: string) => {
    const action = await decide(instanceId);
    expect(String(action.action_type), String(action.instruction)).not.toBe("DATA_REQUIRED");
  };

  it("keeps rejecting a x100 quote even when a user records a matching 1:100 split", async () => {
    const f = await makeFixture("80");
    const holder = await makeHolder(f);
    // 10 units x 1 / 100 = 0.1 units: delta -9.9.
    await recordUserSplit(holder, f.instrumentId, 1, 100, "-9.9");
    feed.prices[f.symbol] = "8000";
    await refresh();
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([80]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  it("keeps rejecting a delisting-stub price even when a user records a matching split", async () => {
    const f = await makeFixture("100");
    const holder = await makeHolder(f);
    // 100 / 8130 = 0.012300...: 10 units x 8130 - 10 = +81290.
    await recordUserSplit(holder, f.instrumentId, 8130, 1, "81290");
    feed.prices[f.symbol] = "0.0123";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  it("keeps rejecting a halved quote with only a user-recorded 2:1 split", async () => {
    const f = await makeFixture("100");
    const holder = await makeHolder(f);
    await recordUserSplit(holder, f.instrumentId, 2, 1, "10");
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect(await rejection(f)).toHaveLength(1);
  });

  it("accepts the post-split quote under a confirmed 2:1 action; the recorder resumes and a bystander stays DATA_REQUIRED", async () => {
    const f = await makeFixture("100");
    const recorder = await makeHolder(f);
    const bystander = await makeHolder(f);
    feed.prices[f.symbol] = "50";

    // Before the action is confirmed the halved price is rejected.
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect(await rejection(f)).toHaveLength(1);

    const actionId = await confirmAction(f.instrumentId, 2, 1);
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100, 50]);
    expect(await rejection(f)).toHaveLength(0);
    const run = await runInfo();
    expect(run).toContain("CORPORATE_ACTION_EXPLAINED_QUOTE");
    expect(run).toContain(actionId);

    // Both still count pre-split units: fail closed until the split is recorded.
    for (const holder of [recorder, bystander]) {
      const action = await decide(holder.instanceId);
      expect(action.action_type).toBe("DATA_REQUIRED");
      expect(String(action.instruction)).toContain("confirmed stock split took effect");
    }

    // The recorder restates its units (10 -> 20) and the next quote resumes it at the new price.
    await recordUserSplit(recorder, f.instrumentId, 2, 1, "10");
    await refresh();
    expect(20 * 50).toBe(10 * 100);
    await resumed(recorder.instanceId);
    const blocked = await decide(bystander.instanceId);
    expect(blocked.action_type).toBe("DATA_REQUIRED");
    expect(String(blocked.instruction)).toContain("confirmed stock split took effect");
  });

  it("does not apply a split twice: a 25 glitch after the accepted 50 is rejected", async () => {
    const f = await makeFixture("100");
    await makeHolder(f);
    await confirmAction(f.instrumentId, 2, 1);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100, 50]);
    feed.prices[f.symbol] = "25";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100, 50]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  it("never touches a quote that already passed plausibility", async () => {
    const f = await makeFixture("100");
    await makeHolder(f);
    await confirmAction(f.instrumentId, 2, 1);
    feed.prices[f.symbol] = "101";
    await refresh();
    expect(await observations(f)).toEqual([100, 101]);
    expect(await runInfo()).not.toContain(f.lineId);
  });

  it("no longer explains a move once the action is revoked", async () => {
    const f = await makeFixture("100");
    await makeHolder(f);
    const actionId = await confirmAction(f.instrumentId, 2, 1);
    await sql!.unsafe("UPDATE corporate_actions SET status='REVOKED',revoked_at=now() WHERE id=$1", [actionId]);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect(await rejection(f)).toHaveLength(1);
  });

  it("accepts a 1:10 reverse split quote under a confirmed action", async () => {
    const f = await makeFixture("5");
    await makeHolder(f);
    await confirmAction(f.instrumentId, 1, 10);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([5, 50]);
  });

  it("covers a sibling trading line of the same instrument for strategies that did not record the split", async () => {
    const instrumentId = await makeInstrument();
    const a = await makeLine(instrumentId, "100");
    const b = await makeLine(instrumentId, "100", false);
    const bystander = await makeHolder(a);
    await confirmAction(instrumentId, 2, 1);
    feed.prices[a.symbol] = "50";
    feed.prices[b.symbol] = "50";
    await refresh();
    expect(await observations(a), await runInfo()).toEqual([100, 50]);
    expect(await observations(b), await runInfo()).toEqual([100, 50]);
    const action = await decide(bystander.instanceId);
    expect(action.action_type).toBe("DATA_REQUIRED");
    expect(String(action.instruction)).toContain("confirmed stock split took effect");
  });

  it("does not block a strategy whose position was opened on the effective date", async () => {
    const f = await makeFixture("100");
    const late = await makeHolder(f, 0);
    await confirmAction(f.instrumentId, 2, 1);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100, 50]);
    await resumed(late.instanceId);
  });
});
