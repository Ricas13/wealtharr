import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {calculateAction,executeAction} from "@/lib/action-service";
import {foldAccountLedger} from "@/domain/ledger";

// A legacy / ON DELETE SET NULL ledger row has no account_id. Calculation attributes it to the
// strategy's primary account; execution must agree (cash sufficiency, over-sell) instead of
// dropping it, and a secondary account must never inherit it.
const dbUrl=process.env.DATABASE_URL;
const db=dbUrl?postgres(dbUrl,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
describe.skipIf(!dbUrl)("null-account ledger rows are folded identically by calculation, execution and switch",()=>{
  let userId="",accountId="",secondaryId="",instanceId="";
  const ids:string[]=[];
  const lineIds:string[]=[];
  beforeAll(async()=>{
    for(const [exposure,ticker] of [["US_EQUITY_3X_LONG","NAQ"+suffix],["LONG_TREASURY_3X_LONG","NAT"+suffix]]){
      const ins=await db!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,3,'USD') RETURNING id",
        ["Fixture "+ticker,exposure]);ids.push(String(ins[0].id));
      const line=await db!.unsafe(
        "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) "+
        "VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01') RETURNING id",[ins[0].id,ticker]);
      const lineId=String(line[0].id);lineIds.push(lineId);
      await db!.unsafe(
        "INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) "+
        "VALUES ($1,3,'US','TAXABLE',$2,'EXACT','2020-01-01',true)",[exposure,lineId]);
      await db!.unsafe(
        "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) "+
        "VALUES ($1,now(),100,'USD','null-account-fixture','CURRENT')",[lineId]);
    }
    const user=await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",["null-acct-"+suffix+"@example.test"]);
    userId=String(user[0].id);
    const account=await db!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'US brokerage','TAXABLE','US','USD') RETURNING id",[userId]);
    accountId=String(account[0].id);
    const instance=await db!.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) "+
      "SELECT $1,$2,d.id,v.id,'Null account test' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
      "WHERE d.key='hfea' AND v.version='1.0' LIMIT 1 RETURNING id,strategy_version_id",[userId,accountId]);
    instanceId=String(instance[0].id);
    await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[instanceId,accountId]);
    await db!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",[instanceId,instance[0].strategy_version_id]);
    // The only cash is a legacy row with NO account.
    await db!.unsafe(
      "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) "+
      "VALUES ($1,NULL,now(),'OPENING_CASH','USD',10000)",[instanceId]);
  });
  afterAll(async()=>{
    if(!db)return;
    if(userId)await db.unsafe("DELETE FROM users WHERE id=$1",[userId]);
    for(const lineId of lineIds){
      await db.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1",[lineId]);
      await db.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1",[lineId]);
      await db.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1",[lineId]);
      await db.unsafe("DELETE FROM trading_lines WHERE id=$1",[lineId]);
    }
    for(const id of ids)await db.unsafe("DELETE FROM instruments WHERE id=$1",[id]);
    await db.end();
  });

  it("calculation and execution both see the null-account cash on the primary account only",async()=>{
    const calculated=await calculateAction(instanceId);
    const action=(await db!.unsafe("SELECT action_type,amount,account_id FROM actions WHERE id=$1",[calculated.actionId]))[0];
    expect(action.action_type).toBe("BUY");
    expect(Number(action.amount)).toBe(5500);
    expect(String(action.account_id)).toBe(accountId);

    // Execution's cash-sufficiency check would reject this fill if it dropped the null-account row.
    await executeAction(userId,calculated.actionId,{price:"100",quantity:"55",fee:"0"});

    const rows=await db!.unsafe(
      "SELECT account_id,event_type,currency,cash_amount,fee_amount,instrument_id,quantity FROM ledger_events "+
      "WHERE strategy_instance_id=$1 ORDER BY occurred_at,created_at",[instanceId]);
    const secondary=await db!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'Second','TAXABLE','US','USD') RETURNING id",[userId]);
    secondaryId=String(secondary[0].id);
    const primaryFold=foldAccountLedger(rows,accountId,accountId,"USD");
    const secondaryFold=foldAccountLedger(rows,secondaryId,accountId,"USD");
    expect(primaryFold.cash.toString()).toBe("4500");
    expect(secondaryFold.cash.toString()).toBe("0");
    expect([...secondaryFold.quantities.values()].every(quantity=>quantity.eq(0))).toBe(true);
  });
});
