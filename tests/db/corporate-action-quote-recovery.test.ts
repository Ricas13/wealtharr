import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

// A real split halves the quoted price. The worker accepts that post-split quote ONLY when an
// administrator-confirmed corporate action explains it. A split a user records in their own ledger
// restates that strategy's units and never explains a price. Only the quote provider is faked; the
// admin route, worker, guard and action service are the real code.
const feed = vi.hoisted(() => ({ prices: {} as Record<string, string> }));
const admin = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/market-data", async (original) => {
  const real = await original<typeof import("@/lib/market-data")>();
  return { ...real, getMarketDataProvider: () => new real.MockMarketDataProvider(feed.prices) };
});
vi.mock("@/lib/session", () => ({
  requireAdminWithMfa: async () => ({ id: admin.id, role: "ADMIN" }),
  requireAdmin: async () => ({ id: admin.id, role: "ADMIN" }),
  requireUser: async () => { throw new Error("UNAUTHENTICATED"); },
  requirePageUser: async () => { throw new Error("UNAUTHENTICATED"); },
  requireAdminPage: async () => { throw new Error("UNAUTHENTICATED"); }
}));

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 3, prepare: false }) : null;
const ORIGIN = "http://127.0.0.1:3000";

type Fixture = { symbol: string; instrumentId: string; lineId: string };
type Holder = { userId: string; accountId: string; instanceId: string };

const dayOffset = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
// Yesterday 21:00 UTC and 09:00 UTC, as SQL expressions.
// Relative to the UTC date captured once in beforeAll, never to a later now(), so a run that crosses
// midnight keeps its quotes and actions consistent.
let TODAY_FOR_SQL = "";
const yesterday2100 = () => `(('${TODAY_FOR_SQL}'::date - interval '3 hours') AT TIME ZONE 'UTC')`;
const yesterday0900 = () => `(('${TODAY_FOR_SQL}'::date - interval '15 hours') AT TIME ZONE 'UTC')`;

describe.skipIf(!url)("corporate-action-explained quote recovery through the market worker", () => {
  const run = Math.random().toString(36).slice(2, 8);
  const users: string[] = [];
  const fixtures: Fixture[] = [];
  const extraInstruments: string[] = [];
  let counter = 0;
  let TODAY = "";

  beforeAll(async () => {
    process.env.MARKET_DATA_PROVIDER = "mock";
    process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
    TODAY = new Date().toISOString().slice(0, 10);
    TODAY_FOR_SQL = TODAY;
    admin.id = String((await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id", [`ca-rec-admin-${run}@example.test`]))[0].id);
    users.push(admin.id);
  });
  // Several EXACT mappings for the same exposure/country/wrapper make market resolution ambiguous,
  // so a finished case retires its mappings.
  afterEach(async () => {
    for (const f of fixtures) await sql!.unsafe("UPDATE regional_instrument_mappings SET enabled=false WHERE trading_line_id=$1", [f.lineId]);
  });
  afterAll(async () => {
    if (!sql) return;
    // confirmed_by is RESTRICT: observations, then actions, then users, then instruments.
    for (const f of fixtures) {
      await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1", [f.lineId]);
      await sql.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1", [f.lineId]);
      await sql.unsafe("DELETE FROM market_data_rejections WHERE trading_line_id=$1", [f.lineId]);
      await sql.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1", [f.lineId]);
      await sql.unsafe("DELETE FROM trading_lines WHERE id=$1", [f.lineId]);
    }
    const instrumentIds = [...new Set([...fixtures.map((f) => f.instrumentId), ...extraInstruments])];
    for (const instrumentId of instrumentIds) await sql.unsafe("DELETE FROM corporate_actions WHERE instrument_id=$1", [instrumentId]);
    for (const userId of users) await sql.unsafe("DELETE FROM users WHERE id=$1", [userId]);
    for (const instrumentId of instrumentIds) await sql.unsafe("DELETE FROM instruments WHERE id=$1", [instrumentId]);
    await sql.end();
  });

  const makeInstrument = async () => {
    counter += 1;
    const id = String((await sql!.unsafe(
      "INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id", [`Corp action ${run}${counter}`]
    ))[0].id);
    extraInstruments.push(id);
    return id;
  };
  // One quote line whose accepted reference was observed at `refObservedSql` (default two days ago).
  const makeLine = async (instrumentId: string, referencePrice: string, options: { mapping?: boolean; refObservedSql?: string } = {}): Promise<Fixture> => {
    counter += 1;
    const symbol = ("CAQ" + run + counter).toUpperCase();
    const lineId = String((await sql!.unsafe(
      "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,$3,'GBP','Europe/London',$4,'2020-01-01') RETURNING id",
      [instrumentId, symbol, "X" + counter, symbol]
    ))[0].id);
    if (options.mapping !== false) {
      await sql!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ('NASDAQ_100_3X_LONG',3,'GB','ISA',$1,'EXACT','2020-01-01',true)", [lineId]);
    }
    await sql!.unsafe(
      `INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,${options.refObservedSql ?? "now()-interval '2 days'"},$2,'GBP','ca-fixture','CURRENT')`,
      [lineId, referencePrice]
    );
    const fixture = { symbol, instrumentId, lineId };
    fixtures.push(fixture);
    return fixture;
  };
  const makeFixture = async (referencePrice: string, options: { refObservedSql?: string } = {}) => makeLine(await makeInstrument(), referencePrice, options);

  // A user with one 9Sig strategy holding 10 units, opened at `openedAt` (default three days ago).
  const makeHolder = async (instrumentId: string, openedAt: string | null = null): Promise<Holder> => {
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
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance) VALUES ($1,$2,COALESCE($3::timestamptz,now()-interval '3 days')-interval '1 minute','OPENING_CASH','GBP',4000,'USER_CONFIRMED')", [instanceId, accountId, openedAt]);
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance) VALUES ($1,$2,COALESCE($3::timestamptz,now()-interval '3 days'),'OPENING_POSITION','GBP',0,$4,10,'USER_CONFIRMED')", [instanceId, accountId, openedAt, instrumentId]);
    return { userId, accountId, instanceId };
  };
  // A user's own split record, as the splits route stores it (quantity delta, ratio metadata).
  const recordUserSplit = async (holder: Holder, instrumentId: string, to: number, from: number, delta: string, atSql = "now()", accountId?: string) => {
    await sql!.unsafe(
      `INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,fee_amount,provenance,confidence,metadata) VALUES ($1,$2,${atSql},'SPLIT','GBP',0,$3,$4,0,'USER_ENTERED','VERIFIED',$5::text::jsonb)`,
      [holder.instanceId, accountId ?? holder.accountId, instrumentId, delta, JSON.stringify({ ratio: `${to}:${from}`, to, from })]
    );
  };
  // An administrator-confirmed split inserted directly (the route is covered separately).
  const confirmAction = async (instrumentId: string, to: number, from: number, effectiveDate = TODAY) =>
    String((await sql!.unsafe(
      "INSERT INTO corporate_actions (instrument_id,kind,ratio_to,ratio_from,effective_date,evidence,confirmed_by) VALUES ($1,'SPLIT',$2,$3,$4::date,$5::text::jsonb,$6) RETURNING id",
      [instrumentId, to, from, effectiveDate, JSON.stringify({ sourceUrl: "https://example.test/split", retrievedAt: TODAY, note: "Issuer notice read and compared" }), admin.id]
    ))[0].id);
  const callRoute = async (body: unknown) => {
    const mod = await import("@/app/api/admin/corporate-actions/route");
    const response = await mod.POST(new Request(`${ORIGIN}/api/admin/corporate-actions`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body)
    }));
    return { status: response.status, json: await response.json() as { ok?: boolean; id?: string; error?: string } };
  };
  const create = (instrumentId: string, ratioTo: number, ratioFrom: number) => callRoute({
    action: "create", instrumentId, ratioTo, ratioFrom, effectiveDate: TODAY,
    evidence: { sourceUrl: "https://example.test/notice", retrievedAt: TODAY, note: "Compared the issuer notice with the exchange page." }
  });

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
  const blocked = async (instanceId: string, text = "confirmed stock split took effect") => {
    const action = await decide(instanceId);
    expect(String(action.action_type), String(action.instruction)).toBe("DATA_REQUIRED");
    expect(String(action.instruction)).toContain(text);
  };
  // The guard with the application's own client (raw-text timestamps), as the action service uses it.
  const verdict = async (holder: Holder, instrumentId: string, priceObservedAt: Date | null) => {
    const { sql: appSql } = await import("@/lib/db");
    const { assessCorporateActions } = await import("@/lib/corporate-action-guard");
    return assessCorporateActions(appSql, { strategyInstanceId: holder.instanceId, instrumentId, primaryAccountId: holder.accountId, priceObservedAt });
  };

  // ---- user splits never explain a price ---------------------------------------------------------

  it("keeps rejecting a x100 quote even when a user records a matching 1:100 split", async () => {
    const f = await makeFixture("80");
    const holder = await makeHolder(f.instrumentId);
    await recordUserSplit(holder, f.instrumentId, 1, 100, "-9.9");
    feed.prices[f.symbol] = "8000";
    await refresh();
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([80]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  it("keeps rejecting a delisting-stub price even when a user records a matching split", async () => {
    const f = await makeFixture("100");
    const holder = await makeHolder(f.instrumentId);
    // 100 / 8130 = 0.012300...: 10 units x 8130 - 10 = +81290.
    await recordUserSplit(holder, f.instrumentId, 8130, 1, "81290");
    feed.prices[f.symbol] = "0.0123";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  it("keeps rejecting a halved quote with only a user-recorded 2:1 split", async () => {
    const f = await makeFixture("100");
    const holder = await makeHolder(f.instrumentId);
    await recordUserSplit(holder, f.instrumentId, 2, 1, "10");
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect(await rejection(f)).toHaveLength(1);
  });

  // ---- confirmed action: acceptance, recorder, bystander -----------------------------------------

  it("confirms through the route from the observed rejection, accepts the quote, and only the recorder resumes", async () => {
    const f = await makeFixture("100");
    const recorder = await makeHolder(f.instrumentId);
    const bystander = await makeHolder(f.instrumentId);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect(await rejection(f)).toHaveLength(1);

    // 4:2 is stored in lowest terms.
    const confirmed = await create(f.instrumentId, 4, 2);
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    const row = (await sql!.unsafe("SELECT ratio_to,ratio_from FROM corporate_actions WHERE id=$1", [String(confirmed.json.id)]))[0];
    expect([Number(row.ratio_to), Number(row.ratio_from)]).toEqual([2, 1]);

    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100, 50]);
    expect(await rejection(f)).toHaveLength(0);
    const info = await runInfo();
    expect(info).toContain("CORPORATE_ACTION_EXPLAINED_QUOTE");
    expect(info).toContain(String(confirmed.json.id));
    const linked = await sql!.unsafe("SELECT explained_by_corporate_action_id FROM market_data_observations WHERE trading_line_id=$1 AND price=50", [f.lineId]);
    expect(String(linked[0].explained_by_corporate_action_id)).toBe(String(confirmed.json.id));

    // Both still count pre-split units: fail closed until the split is recorded.
    await blocked(recorder.instanceId);
    await blocked(bystander.instanceId);

    await recordUserSplit(recorder, f.instrumentId, 2, 1, "10");
    await refresh();
    await resumed(recorder.instanceId);
    await blocked(bystander.instanceId);
  });

  it("revoking deletes the explained quote and the later ones judged against it, and 50 is rejected again", async () => {
    const f = await makeFixture("100");
    await makeHolder(f.instrumentId);
    feed.prices[f.symbol] = "50";
    await refresh();
    const confirmed = await create(f.instrumentId, 2, 1);
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    await refresh();
    await refresh();
    expect(await observations(f)).toEqual([100, 50, 50]);

    const revoked = await callRoute({ action: "revoke", id: String(confirmed.json.id), reason: "The issuer withdrew the notice that was used." });
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);
    expect(await observations(f)).toEqual([100]);
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  it("does not apply a split twice: a 25 glitch after the accepted 50 is rejected", async () => {
    const f = await makeFixture("100");
    await makeHolder(f.instrumentId);
    await confirmAction(f.instrumentId, 2, 1);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100, 50]);
    feed.prices[f.symbol] = "25";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100, 50]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  it("accepts the halved price after a lagging provider stamped 100 on the effective day", async () => {
    const f = await makeFixture("100", { refObservedSql: yesterday2100() });
    await makeHolder(f.instrumentId);
    await confirmAction(f.instrumentId, 2, 1);
    feed.prices[f.symbol] = "100";
    await refresh();
    expect(await observations(f)).toEqual([100, 100]);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100, 100, 50]);
    feed.prices[f.symbol] = "25";
    await refresh();
    expect(await observations(f)).toEqual([100, 100, 50]);
  });

  it("never touches a quote that already passed plausibility", async () => {
    const f = await makeFixture("100");
    await makeHolder(f.instrumentId);
    await confirmAction(f.instrumentId, 2, 1);
    feed.prices[f.symbol] = "101";
    await refresh();
    expect(await observations(f)).toEqual([100, 101]);
    expect(await runInfo()).not.toContain(f.lineId);
  });

  it("applies the holder rule to a 3:2 split that passed plausibility once an admin confirms it", async () => {
    const f = await makeFixture("100");
    const holder = await makeHolder(f.instrumentId);
    feed.prices[f.symbol] = "66.67";
    await refresh();
    expect(await observations(f)).toEqual([100, 66.67]);
    // No action yet: the pre-split units are valued at the post-split price (the documented gap).
    await resumed(holder.instanceId);
    const confirmed = await create(f.instrumentId, 3, 2);
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    await blocked(holder.instanceId);
  });

  it("no longer explains a move once the action is revoked", async () => {
    const f = await makeFixture("100");
    await makeHolder(f.instrumentId);
    const actionId = await confirmAction(f.instrumentId, 2, 1);
    await sql!.unsafe("UPDATE corporate_actions SET status='REVOKED',revoked_at=now() WHERE id=$1", [actionId]);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect(await rejection(f)).toHaveLength(1);
  });

  it("accepts a 1:10 reverse split quote under a confirmed action", async () => {
    const f = await makeFixture("5");
    await makeHolder(f.instrumentId);
    await confirmAction(f.instrumentId, 1, 10);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([5, 50]);
  });

  it("covers a sibling trading line of the same instrument for strategies that did not record the split", async () => {
    const instrumentId = await makeInstrument();
    const a = await makeLine(instrumentId, "100");
    const b = await makeLine(instrumentId, "100", { mapping: false });
    const bystander = await makeHolder(instrumentId);
    await confirmAction(instrumentId, 2, 1);
    feed.prices[a.symbol] = "50";
    feed.prices[b.symbol] = "50";
    await refresh();
    expect(await observations(a), await runInfo()).toEqual([100, 50]);
    expect(await observations(b), await runInfo()).toEqual([100, 50]);
    await blocked(bystander.instanceId);
  });

  it("does not block a strategy whose position was opened on the effective date", async () => {
    const f = await makeFixture("100");
    // One captured instant: the position opens now, the action is effective on that instant's UTC date.
    const instant = new Date();
    const late = await makeHolder(f.instrumentId, instant.toISOString());
    await confirmAction(f.instrumentId, 2, 1, instant.toISOString().slice(0, 10));
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100, 50]);
    await resumed(late.instanceId);
  });

  // ---- per-account, per-action matching ----------------------------------------------------------

  it("blocks the GIA when the split was recorded only in the ISA", async () => {
    const instrumentId = await makeInstrument();
    const holder = await makeHolder(instrumentId);
    const gia = String((await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'GIA','GIA','GB','GBP') RETURNING id", [holder.userId]))[0].id);
    await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'SECONDARY')", [holder.instanceId, gia]);
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance) VALUES ($1,$2,now()-interval '3 days','OPENING_POSITION','GBP',0,$3,10,'USER_CONFIRMED')", [holder.instanceId, gia, instrumentId]);
    await confirmAction(instrumentId, 2, 1);
    await recordUserSplit(holder, instrumentId, 2, 1, "10");
    const first = await verdict(holder, instrumentId, new Date());
    expect(first).toMatchObject({ kind: "UNRECORDED", accountId: gia });
    await recordUserSplit(holder, instrumentId, 2, 1, "10", "now()", gia);
    expect(await verdict(holder, instrumentId, new Date())).toEqual({ kind: "OK" });
  });

  it("keeps an earlier confirmed split blocking when only the later one was recorded", async () => {
    const instrumentId = await makeInstrument();
    const holder = await makeHolder(instrumentId, new Date(Date.now() - 60 * 86_400_000).toISOString());
    await confirmAction(instrumentId, 2, 1, dayOffset(40));
    await confirmAction(instrumentId, 3, 1, dayOffset(10));
    await recordUserSplit(holder, instrumentId, 3, 1, "20", "now()-interval '10 days'");
    expect(await verdict(holder, instrumentId, new Date())).toMatchObject({ kind: "UNRECORDED", effectiveDate: dayOffset(40) });
    await recordUserSplit(holder, instrumentId, 2, 1, "10", "now()-interval '40 days'");
    expect(await verdict(holder, instrumentId, new Date())).toEqual({ kind: "OK" });
  });

  it("does not let a mistyped ratio clear a confirmed 2:1", async () => {
    const instrumentId = await makeInstrument();
    const holder = await makeHolder(instrumentId);
    await confirmAction(instrumentId, 2, 1);
    await recordUserSplit(holder, instrumentId, 3, 1, "20");
    expect(await verdict(holder, instrumentId, new Date())).toMatchObject({ kind: "UNRECORDED" });
  });

  it("does not affect an account that was sold out before, or re-bought after, the effective date", async () => {
    const instrumentId = await makeInstrument();
    const holder = await makeHolder(instrumentId, new Date(Date.now() - 5 * 86_400_000).toISOString());
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance) VALUES ($1,$2,now()-interval '2 days','SELL','GBP',1000,$3,-10,'USER_CONFIRMED')", [holder.instanceId, holder.accountId, instrumentId]);
    await confirmAction(instrumentId, 2, 1);
    expect(await verdict(holder, instrumentId, new Date())).toEqual({ kind: "OK" });
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance) VALUES ($1,$2,now(),'BUY','GBP',-500,$3,10,'USER_CONFIRMED')", [holder.instanceId, holder.accountId, instrumentId]);
    expect(await verdict(holder, instrumentId, new Date())).toEqual({ kind: "OK" });
  });

  // ---- a price observed before the effective date is never used with post-split units ------------

  it("waits for a post-split price: a recorder is never valued at the pre-split price", async () => {
    const f = await makeFixture("100", { refObservedSql: yesterday2100() });
    const recorder = await makeHolder(f.instrumentId);
    await confirmAction(f.instrumentId, 2, 1);
    // The accepted quote is from yesterday 21:00; the split is recorded as of yesterday 09:00.
    await recordUserSplit(recorder, f.instrumentId, 2, 1, "10", yesterday0900());
    // A price observed before the effective date's 00:00 UTC is awaiting; one on/after it is fine.
    expect(await verdict(recorder, f.instrumentId, new Date(Date.now() - 2 * 86_400_000))).toMatchObject({ kind: "AWAITING_PRICE" });
    expect(await verdict(recorder, f.instrumentId, new Date())).toEqual({ kind: "OK" });
    await blocked(recorder.instanceId, "waiting for a post-split price");
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100, 50]);
    await resumed(recorder.instanceId);
  });

  // ---- revocation keeps the restored reference in force, however old --------------------------------

  const ageEverything = async (f: Fixture) =>
    sql!.unsafe("UPDATE market_data_observations SET observed_at=observed_at-interval '9 days' WHERE trading_line_id=$1", [f.lineId]);

  it("after a mistaken 1:100 is revoked 9 days later, the same 8000 quote is still rejected", async () => {
    const f = await makeFixture("80", { refObservedSql: "now()-interval '1 day'" });
    await makeHolder(f.instrumentId);
    const actionId = await confirmAction(f.instrumentId, 1, 100);
    feed.prices[f.symbol] = "8000";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([80, 8000]);
    // Nine days pass: the pre-split reference is now older than the 7-day reference window.
    await ageEverything(f);
    const revoked = await callRoute({ action: "revoke", id: actionId, reason: "The notice described a currency change, not a split." });
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);
    expect(await observations(f)).toEqual([80]);
    expect((await rejection(f))[0].reason).toBe("CORPORATE_ACTION_REVOKED");
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([80]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  it("after a genuine 2:1 is revoked by mistake 9 days later, the post-split price is rejected until it is re-confirmed", async () => {
    const f = await makeFixture("100", { refObservedSql: "now()-interval '1 day'" });
    const bystander = await makeHolder(f.instrumentId);
    const actionId = await confirmAction(f.instrumentId, 2, 1);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100, 50]);
    await ageEverything(f);
    const revoked = await callRoute({ action: "revoke", id: actionId, reason: "Revoked by mistake while reviewing the list." });
    expect(revoked.status).toBe(200);
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
    // The bystander is not valued at 50 x 10 (500 instead of 1000): the rejected quote blocks it.
    const action = await decide(bystander.instanceId);
    expect(String(action.action_type), String(action.instruction)).toBe("DATA_REQUIRED");
    // Re-confirming (a new action) lets the same quote be explained again.
    const again = await create(f.instrumentId, 2, 1);
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100, 50]);
  });

  // ---- a PENDING proposal does nothing -----------------------------------------------------------

  it("lets a PENDING proposal neither explain a quote nor block a strategy", async () => {
    const f = await makeFixture("100");
    const holder = await makeHolder(f.instrumentId);
    await sql!.unsafe(
      "INSERT INTO corporate_actions (instrument_id,kind,ratio_to,ratio_from,effective_date,status,evidence,created_by,confirmed_by,confirmed_at,expires_at) VALUES ($1,'SPLIT',2,1,$2::date,'PENDING','{}'::jsonb,$3,NULL,NULL,now()+interval '7 days')",
      [f.instrumentId, TODAY, admin.id]
    );
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f)).toEqual([100]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
    expect(await verdict(holder, f.instrumentId, new Date())).toEqual({ kind: "OK" });
  });

  // ---- no double application after the price drifted ---------------------------------------------

  it("does not re-explain a 50 print after the price drifted 100 -> 50 -> 30", async () => {
    const f = await makeFixture("100");
    await makeHolder(f.instrumentId);
    await confirmAction(f.instrumentId, 2, 1);
    feed.prices[f.symbol] = "50";
    await refresh();
    feed.prices[f.symbol] = "30";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100, 50, 30]);
    feed.prices[f.symbol] = "50";
    await refresh();
    expect(await observations(f), await runInfo()).toEqual([100, 50, 30]);
    expect((await rejection(f))[0].reason).toBe("IMPLAUSIBLE_MOVE");
  });

  // ---- a duplicate split is ambiguous: fail closed ------------------------------------------------

  it("treats two unreversed splits for one action on one account as unrecorded", async () => {
    const instrumentId = await makeInstrument();
    const holder = await makeHolder(instrumentId);
    await confirmAction(instrumentId, 2, 1);
    await recordUserSplit(holder, instrumentId, 2, 1, "10");
    expect(await verdict(holder, instrumentId, new Date())).toEqual({ kind: "OK" });
    await recordUserSplit(holder, instrumentId, 2, 1, "20");
    expect(await verdict(holder, instrumentId, new Date())).toMatchObject({ kind: "UNRECORDED", duplicate: true });
    // A matching split next to a mistyped one is equally ambiguous.
    const other = await makeHolder(instrumentId);
    await recordUserSplit(other, instrumentId, 3, 1, "20");
    await recordUserSplit(other, instrumentId, 2, 1, "10");
    expect(await verdict(other, instrumentId, new Date())).toMatchObject({ kind: "UNRECORDED", duplicate: true });
  });

  // ---- revoking keeps the history of strategies that were not holding at the effective date --------

  it("deletes value history only for strategies holding at the effective date, and only from that date", async () => {
    const f = await makeFixture("100");
    const holding = await makeHolder(f.instrumentId);
    const soldOut = await makeHolder(f.instrumentId, new Date(Date.now() - 5 * 86_400_000).toISOString());
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance) VALUES ($1,$2,now()-interval '2 days','SELL','GBP',1000,$3,-10,'USER_CONFIRMED')", [soldOut.instanceId, soldOut.accountId, f.instrumentId]);
    const actionId = await confirmAction(f.instrumentId, 2, 1);
    feed.prices[f.symbol] = "50";
    await refresh();
    for (const holder of [holding, soldOut]) {
      await sql!.unsafe("INSERT INTO performance_series (strategy_instance_id,series_type,date,value,metadata) VALUES ($1,'USER_VALUE',$2::date,1000,'{}'::jsonb)", [holder.instanceId, TODAY]);
      await sql!.unsafe("INSERT INTO performance_series (strategy_instance_id,series_type,date,value,metadata) VALUES ($1,'USER_VALUE',$2::date,1000,'{}'::jsonb)", [holder.instanceId, dayOffset(3)]);
    }
    const revoked = await callRoute({ action: "revoke", id: actionId, reason: "Revoked while checking the corporate action list." });
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);
    const dates = async (instanceId: string) =>
      (await sql!.unsafe("SELECT date::text AS date FROM performance_series WHERE strategy_instance_id=$1 AND series_type='USER_VALUE' ORDER BY date", [instanceId])).map((r) => String(r.date).slice(0, 10));
    // Holding strategy: the effective date onwards is gone, earlier history stays.
    expect(await dates(holding.instanceId)).toEqual([dayOffset(3)]);
    // Sold out before the effective date: everything stays.
    expect(await dates(soldOut.instanceId)).toEqual([dayOffset(3), TODAY]);
  });
});
