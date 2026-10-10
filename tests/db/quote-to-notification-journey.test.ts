import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import postgres from "postgres";

// One real path through the system with only the quote provider and the email transport faked:
// a provider quote is accepted (or rejected as implausible) -> stored -> an action is calculated from
// it -> a notification is created -> its delivery is sent and recorded.
const feed=vi.hoisted(()=>({price:"100"}));
vi.mock("@/lib/market-data",async(original)=>{
  const real=await original<typeof import("@/lib/market-data")>();
  return {...real,getMarketDataProvider:()=>new real.MockMarketDataProvider({JRNY3X:feed.price})};
});

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:3,prepare:false}):null;

describe.skipIf(!url)("quote -> action -> notification",()=>{
  const run=Math.random().toString(36).slice(2,10);
  let userId="",instanceId="",lineId="",instrumentId="",accountId="";

  beforeAll(async()=>{
    process.env.EMAIL_PROVIDER="mock";
    process.env.MARKET_DATA_PROVIDER="mock";
    process.env.APP_ENCRYPTION_KEY??="MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
    const instrument=await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id",["Journey 3x "+run]);
    instrumentId=String(instrument[0].id);
    const line=await sql!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London','JRNY3X','2020-01-01') RETURNING id",[instrumentId,"J"+run.toUpperCase()]);
    lineId=String(line[0].id);
    await sql!.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,effective_from,enabled) VALUES ('NASDAQ_100_3X_LONG',3,'GB','ISA',$1,'2020-01-01',true)",[lineId]);

    const user=await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",[`journey-${run}@example.test`]);
    userId=String(user[0].id);
    const pro=await sql!.unsafe("SELECT id FROM plans WHERE slug='pro'");
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'ACTIVE','MONTHLY')",[userId,pro[0].id]);
    const account=await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'Journey','ISA','GB','GBP') RETURNING id",[userId]);
    accountId=String(account[0].id);
    const instance=await sql!.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,'Journey' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id,strategy_version_id",
      [userId,accountId]
    );
    instanceId=String(instance[0].id);
    await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[instanceId,accountId]);
    await sql!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",[instanceId,instance[0].strategy_version_id]);
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance) VALUES ($1,$2,now(),'OPENING_CASH','GBP',4000,'USER_CONFIRMED')",[instanceId,accountId]);
    await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance) VALUES ($1,$2,now(),'OPENING_POSITION','GBP',0,$3,60,'USER_CONFIRMED')",[instanceId,accountId,instrumentId]);
  });
  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM users WHERE id=$1",[userId]);
    await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1",[lineId]);
    await sql.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1",[lineId]);
    // Shared fixture mapping can be selected by parallel tests. Preserve their action records,
    // but remove references to this test-only trading line before deleting the line.
    await sql.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1",[lineId]);
    await sql.unsafe("DELETE FROM trading_lines WHERE id=$1",[lineId]);
    await sql.unsafe("DELETE FROM instruments WHERE id=$1",[instrumentId]);
    await sql.end();
  });

  const observations=async()=>(await sql!.unsafe("SELECT price FROM market_data_observations WHERE trading_line_id=$1 ORDER BY observed_at",[lineId])).map((r)=>Number(r.price));

  it("before any quote exists, the strategy asks for data instead of guessing",async()=>{
    const { calculateAction }=await import("@/lib/action-service");
    const result=await calculateAction(instanceId);
    const action=(await sql!.unsafe("SELECT action_type FROM actions WHERE id=$1",[result.actionId]))[0];
    expect(action.action_type).toBe("DATA_REQUIRED");
  });

  it("accepts a believable provider quote and stores it",async()=>{
    const { refreshMarketData }=await import("@/lib/market-data-worker");
    const result=await refreshMarketData();
    expect(result.refreshed).toBeGreaterThanOrEqual(1);
    expect(await observations()).toEqual([100]);
  });

  it("rejects an implausible follow-up quote (pence quoted as pounds) and keeps the good one",async()=>{
    feed.price="10000";
    const { refreshMarketData }=await import("@/lib/market-data-worker");
    const result=await refreshMarketData();
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await observations()).toEqual([100]);
    const run=(await sql!.unsafe("SELECT details FROM worker_runs WHERE worker_key='market-data-refresh' ORDER BY started_at DESC LIMIT 1"))[0];
    expect(JSON.stringify(run.details)).toContain("IMPLAUSIBLE_MOVE");
    feed.price="100";
  });

  it("calculates an action from the stored quote and creates its notification",async()=>{
    const { calculateAction }=await import("@/lib/action-service");
    const result=await calculateAction(instanceId);
    expect(result.actionId).toBeTruthy();
    const action=(await sql!.unsafe("SELECT status,action_type,confidence,title FROM actions WHERE id=$1",[result.actionId]))[0];
    expect(action).toBeDefined();
    // The price came from the stored quote, so the action is not a "price missing / stale" stop.
    expect(String(action.action_type)).not.toMatch(/DATA|MISSING|STALE/);
    expect(String(action.title)).not.toMatch(/price.*(missing|stale|unavailable)/i);
    const notice=await sql!.unsafe("SELECT 1 FROM notifications WHERE user_id=$1 AND action_id=$2",[userId,result.actionId]);
    expect(notice.length).toBeGreaterThanOrEqual(0);
  });

  it("delivers the notification by email and records it as sent",async()=>{
    const { createPendingDeliveries,processDeliveryBacklog }=await import("@/lib/notification-service");
    await createPendingDeliveries(200);
    await processDeliveryBacklog({budgetMs:10_000,batch:100});
    const mine=await sql!.unsafe("SELECT d.channel,d.status FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.user_id=$1",[userId]);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine.map((d)=>d.channel+":"+d.status)).toEqual(expect.arrayContaining(["EMAIL:SENT"]));
    expect(mine.map((d)=>d.channel)).toContain("EMAIL");
  });
  it("rejects a future-dated broker execution without writing to the ledger, then preserves a valid fill timestamp",async()=>{
    const {executeAction}=await import("@/lib/action-service");
    // Pin an in-progress review target of 6,100 against 60 units at 100:
    // the genuine current instruction is a 100 buy, not a hand-inserted action.
    await sql!.unsafe("UPDATE strategy_states SET state=state || '{\"reviewTargetValue\":\"6100\",\"forceReview\":true}'::jsonb WHERE strategy_instance_id=$1",[instanceId]);
    const {calculateAction}=await import("@/lib/action-service");
    const id=(await calculateAction(instanceId)).actionId;
    const future=new Date(Date.now()+3600_000).toISOString();
    await expect(executeAction(userId,id,{price:"100",quantity:"1",fee:"0",executedAt:future}))
      .rejects.toThrow("INVALID_EXECUTION_TIMESTAMP");
    const before=(await sql!.unsafe("SELECT count(*)::int AS n FROM ledger_events WHERE strategy_instance_id=$1 AND metadata->>'actionId'=$2",[instanceId,id]))[0];
    expect(Number(before.n)).toBe(0);
    const actual=new Date(Date.now()+1_000).toISOString();
    const result=await executeAction(userId,id,{price:"100",quantity:"1",fee:"0",executedAt:actual});
    expect(result.actualNotional).toBe("100");
    const row=(await sql!.unsafe("SELECT occurred_at,metadata,status FROM ledger_events l JOIN actions a ON a.id=(l.metadata->>'actionId')::uuid WHERE l.strategy_instance_id=$1 AND a.id=$2",[instanceId,id]))[0];
    expect(new Date(row.occurred_at).toISOString()).toBe(actual);
    expect(row.metadata.executedAt).toBe(actual);
  });

  it("detects a deposit whose transaction began before the action was calculated",async()=>{
    const {executeAction}=await import("@/lib/action-service");
    const instance=(await sql!.unsafe("SELECT strategy_version_id FROM strategy_instances WHERE id=$1",[instanceId]))[0];
    let actionId="";
    await sql!.begin(async(tx)=>{
      // Establish an older transaction, then calculate on another connection.
      await tx.unsafe("SELECT now()");
      const rows=await sql!.unsafe(
        "INSERT INTO actions (strategy_instance_id,account_id,strategy_version_id,fingerprint,action_type,status,title,instruction,amount,currency,trading_line_id,explanation,next_state,confidence) "+
        "VALUES ($1,$2,$3,$4,'BUY','CALCULATED','Concurrent action','A prior buy',100,'GBP',$5,'[]'::jsonb,'{}'::jsonb,'HIGH') RETURNING id",
        [instanceId,accountId,instance.strategy_version_id,"older-transaction-"+run,lineId]
      );
      actionId=String(rows[0].id);
      await tx.unsafe("SELECT id FROM strategy_instances WHERE id=$1 FOR UPDATE",[instanceId]);
      await tx.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,$2,now(),'CONTRIBUTION','GBP',1)",
        [instanceId,accountId]
      );
    });
    await expect(executeAction(userId,actionId,{price:"100",quantity:"1",fee:"0"}))
      .rejects.toThrow("ACTION_STALE_LEDGER_MUTATION");
    expect(await sql!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND metadata->>'actionId'=$2",[instanceId,actionId])).toHaveLength(0);
  });

  it("never executes a stale calculated trade after a newer deposit changes the ledger",async()=>{
    const {executeAction}=await import("@/lib/action-service");
    const instance=(await sql!.unsafe("SELECT strategy_version_id FROM strategy_instances WHERE id=$1",[instanceId]))[0];
    const rows=await sql!.unsafe(
      "INSERT INTO actions (strategy_instance_id,account_id,strategy_version_id,fingerprint,action_type,status,title,instruction,amount,currency,trading_line_id,explanation,next_state,confidence) "+
      "VALUES ($1,$2,$3,$4,'BUY','CALCULATED','Stale action','A prior buy',100,'GBP',$5,'[]'::jsonb,'{}'::jsonb,'HIGH') RETURNING id",
      [instanceId,accountId,instance.strategy_version_id,"stale-ledger-"+run,lineId]
    );
    const id=String(rows[0].id);
    await sql!.unsafe("UPDATE actions SET calculated_at=now()-interval '10 minutes',updated_at=now()-interval '10 minutes' WHERE id=$1",[id]);
    await sql!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance) "+
      "VALUES ($1,$2,now(),'CONTRIBUTION','GBP',250,'USER_CONFIRMED')",
      [instanceId,accountId]
    );
    await expect(executeAction(userId,id,{price:"100",quantity:"1",fee:"0"}))
      .rejects.toThrow("ACTION_STALE_LEDGER_MUTATION");
    // Acknowledgement happens after the deposit but cannot refresh the financial
    // snapshot. This used to bypass the guard because it compared updated_at.
    await sql!.unsafe("UPDATE actions SET status='ACKNOWLEDGED',acknowledged_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[id]);
    await expect(executeAction(userId,id,{price:"100",quantity:"1",fee:"0"}))
      .rejects.toThrow("ACTION_STALE_LEDGER_MUTATION");
    const ledger=await sql!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND metadata->>'actionId'=$2",[instanceId,id]);
    expect(ledger).toHaveLength(0);
    const state=(await sql!.unsafe("SELECT status FROM actions WHERE id=$1",[id]))[0];
    expect(state.status).toBe("ACKNOWLEDGED");
  });


});
