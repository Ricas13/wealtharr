import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {calculateAction} from "@/lib/action-service";
import {TWO_FUNDS_2050_TDF,TWO_FUNDS_SCV} from "@/domain/strategy/two-funds-engine";
import {TRINITY_TRADE_UNIVERSE,TRINITY_SIGNALS} from "@/domain/strategy/trinity-model";

const url=process.env.DATABASE_URL;
const db=url?postgres(url,{max:3,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,9).toUpperCase();
const exposures=[...new Set([TWO_FUNDS_2050_TDF,TWO_FUNDS_SCV,...TRINITY_TRADE_UNIVERSE,...TRINITY_SIGNALS])];

describe.skipIf(!url)("Group 3 dynamic strategies: PostgreSQL action lifecycle",()=>{
  let user="",account="";
  const lines:string[]=[],instruments:string[]=[],instances=new Map<string,string>();
  beforeAll(async()=>{
    for(const [i,exposure] of exposures.entries()){
      const inst=await db!.unsafe(
        "INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,1,'USD') RETURNING id",
        ["Group3 dynamic fixture "+exposure,exposure]);const instrument=String(inst[0].id);instruments.push(instrument);
      const ticker="DG3"+suffix+i;
      const line=await db!.unsafe(
        "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01') RETURNING id",
        [instrument,ticker]);const lineId=String(line[0].id);lines.push(lineId);
      await db!.unsafe(
        "INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ($1,1,'US','BROKERAGE',$2,'EXACT','2020-01-01',true)",
        [exposure,lineId]);
      await db!.unsafe(
        "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now(),100,'USD','g3-dynamic','CURRENT')",
        [lineId]);
    }
    user=String((await db!.unsafe("INSERT INTO users(email,password_hash,country,base_currency,timezone) VALUES($1,'x','US','USD','America/New_York') RETURNING id",
      ["g3-dynamic-"+suffix+"@example.test"]))[0].id);
    account=String((await db!.unsafe(
      "INSERT INTO accounts(user_id,name,wrapper,country,currency) VALUES ($1,'US brokerage','BROKERAGE','US','USD') RETURNING id",[user]))[0].id);
    for(const key of ["two-funds-for-life","trinity"]){
      const version=await db!.unsafe(
        "SELECT d.id AS definition_id,v.id AS version_id FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key=$1 AND v.lifecycle_status='PUBLISHED' ORDER BY v.effective_from DESC LIMIT 1",
        [key]);
      expect(version).toHaveLength(1);
      const row=await db!.unsafe(
        "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [user,account,version[0].definition_id,version[0].version_id,"Group 3 "+key]);
      const instance=String(row[0].id);instances.set(key,instance);
      await db!.unsafe("INSERT INTO strategy_accounts(strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",
        [instance,account]);
      await db!.unsafe("INSERT INTO strategy_states(strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",
        [instance,version[0].version_id]);
      await db!.unsafe(
        "INSERT INTO ledger_events(strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,$2,now(),'OPENING_CASH','USD',10000)",
        [instance,account]);
    }
  });
  afterAll(async()=>{
    if(!db)return;
    if(user)await db.unsafe("DELETE FROM users WHERE id=$1",[user]);
    for(const line of lines){
      await db.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1",[line]);
      await db.unsafe("DELETE FROM price_history WHERE trading_line_id=$1",[line]);
      await db.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1",[line]);
      await db.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1",[line]);
      await db.unsafe("DELETE FROM trading_lines WHERE id=$1",[line]);
    }
    for(const inst of instruments)await db.unsafe("DELETE FROM instruments WHERE id=$1",[inst]);
    await db.end();
  });
  const action=async(key:string)=>{
    const r=await calculateAction(instances.get(key)!);
    return (await db!.unsafe("SELECT action_type,amount,trading_line_id,instruction FROM actions WHERE id=$1",[r.actionId]))[0];
  };
  it("Merriman 2050 creates a real mapped age-adjusted buy using 2026 target weights",async()=>{
    const row=await action("two-funds-for-life");
    expect(row.action_type).toBe("BUY");
    // 2050 - 2026 = 24YTR, US small value 36%, TDF 64%.
    expect(Number(row.amount)).toBeCloseTo(6400,2);
    expect(row.trading_line_id).not.toBeNull();
  });
  it("Trinity refuses live trading when adjusted month-end signals are absent",async()=>{
    const row=await action("trinity");
    expect(row.action_type).toBe("DATA_REQUIRED");
  });
  it("Trinity calculates a mapped order only after ten licensed complete daily series",async()=>{
    const now=new Date();
    const since=new Date(now.getTime()-460*86400_000).toISOString().slice(0,10);
    const through=now.toISOString().slice(0,10);
    for(const exposure of TRINITY_SIGNALS){
      const idx=exposures.indexOf(exposure),line=lines[idx];
      await db!.unsafe(
        "INSERT INTO price_history(trading_line_id,trading_day,adjusted_close,currency,provider,licensed,adjustment_verified) "+
        "SELECT $1,d::date, 100+(d::date-$2::date)*0.10, 'USD','group3-adjusted-fixture',true,true "+
        "FROM generate_series($2::date,$3::date,interval '1 day') AS d "+
        "WHERE extract(isodow FROM d) BETWEEN 1 AND 5",
        [line,since,through]
      );
    }
    const row=await action("trinity");
    expect(row.action_type).toBe("BUY");
    expect(Number(row.amount)).toBeGreaterThan(0);
    expect(row.trading_line_id).not.toBeNull();
  });
});
