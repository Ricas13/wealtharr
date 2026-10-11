import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {calculateAction} from "@/lib/action-service";

const dbUrl=process.env.DATABASE_URL;
const db=dbUrl?postgres(dbUrl,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
describe.skipIf(!dbUrl)("HFEA partial UK ISA must not generate a trade",()=>{
  let userId="",accountId="",instrumentId="",lineId="",instanceId="";
  beforeAll(async()=>{
    const ins=await db!.unsafe(
      "INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'US_EQUITY_3X_LONG',3,'GBP') RETURNING id",
      ["Partial HFEA equity "+suffix]);
    instrumentId=String(ins[0].id);
    const line=await db!.unsafe(
      "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) "+
      "VALUES ($1,$2,'LSE','GBP','Europe/London',$2,'2020-01-01') RETURNING id",
      [instrumentId,"X"+suffix.toUpperCase()]);
    lineId=String(line[0].id);
    await db!.unsafe(
      "INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,effective_from,enabled) "+
      "VALUES ('US_EQUITY_3X_LONG',3,'GB','ISA',$1,'2020-01-01',true)",[lineId]);
    const user=await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",
      ["partial-hfea-"+suffix+"@example.test"]);
    userId=String(user[0].id);
    const account=await db!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'ISA','ISA','GB','GBP') RETURNING id",[userId]);
    accountId=String(account[0].id);
    const created=await db!.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) "+
      "SELECT $1,$2,d.id,v.id,'HFEA partial market test' FROM strategy_definitions d "+
      "JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
      "WHERE d.key='hfea' AND v.version='1.0' LIMIT 1 RETURNING id,strategy_version_id",
      [userId,accountId]
    );
    instanceId=String(created[0].id);
    await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[instanceId,accountId]);
    await db!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",[instanceId,created[0].strategy_version_id]);
    await db!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,$2,now(),'OPENING_CASH','GBP',10000)",[instanceId,accountId]);
  });
  afterAll(async()=>{
    if(!db)return;
    if(userId)await db.unsafe("DELETE FROM users WHERE id=$1",[userId]);
    if(lineId)await db.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1",[lineId]);
    if(lineId)await db.unsafe("DELETE FROM trading_lines WHERE id=$1",[lineId]);
    if(instrumentId)await db.unsafe("DELETE FROM instruments WHERE id=$1",[instrumentId]);
    await db.end();
  });
  it("shows unsupported complete market and does not fabricate a buy from a partial equity mapping",async()=>{
    const calculated=await calculateAction(instanceId);
    const action=(await db!.unsafe("SELECT action_type,status,title,instruction,amount,trading_line_id FROM actions WHERE id=$1",
      [calculated.actionId]))[0];
    expect(action.action_type).toBe("DATA_REQUIRED");
    expect(String(action.instruction)).toMatch(/cannot be implemented.*LONG_TREASURY_3X_LONG/i);
    expect(action.trading_line_id).toBeNull();
    expect(action.amount).toBeNull();
  });
});
