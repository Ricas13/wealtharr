import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {getStrategyPlugin} from "@/domain/strategy/catalog";
import {calculateAction} from "@/lib/action-service";

const url=process.env.DATABASE_URL;
const db=url?postgres(url,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
const keys=["bernstein-no-brainer","larry-portfolio","pinwheel"] as const;
const allExposures=[...new Set(keys.flatMap(k=>
  ((getStrategyPlugin(k)!.profile!.config!.allocations) as {exposure:string}[]).map(x=>x.exposure)))];

describe.skipIf(!url)("Group 3 static methods: real database calculation",()=>{
  let user="",account="";
  const instruments:string[]=[],lines:string[]=[],instances:string[]=[];
  beforeAll(async()=>{
    for(const [i,exposure] of allExposures.entries()){
      const instrument=await db!.unsafe(
        "INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,1,'GBP') RETURNING id",
        ["G3 fixture "+exposure,exposure]);const instrumentId=String(instrument[0].id);instruments.push(instrumentId);
      const ticker="G3"+suffix.toUpperCase()+i;
      const line=await db!.unsafe(
        "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London',$2,'2020-01-01') RETURNING id",
        [instrumentId,ticker]);const lineId=String(line[0].id);lines.push(lineId);
      await db!.unsafe(
        "INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ($1,1,'GB','ISA',$2,'EXACT','2020-01-01',true)",
        [exposure,lineId]);
      await db!.unsafe(
        "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) VALUES ($1,now(),100,'GBP','group3-fixture','CURRENT')",
        [lineId]);
    }
    user=String((await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",
      ["group3-"+suffix+"@example.test"]))[0].id);
    account=String((await db!.unsafe(
      "INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'Group 3 ISA','ISA','GB','GBP') RETURNING id",
      [user]))[0].id);
    for(const key of keys){
      const version=await db!.unsafe("SELECT d.id AS definition_id,v.id AS version_id FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key=$1 AND v.lifecycle_status='PUBLISHED' ORDER BY v.effective_from DESC LIMIT 1",[key]);
      expect(version).toHaveLength(1);
      const row=await db!.unsafe(
        "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [user,account,version[0].definition_id,version[0].version_id,key]);
      const instance=String(row[0].id);instances.push(instance);
      await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",
        [instance,account]);
      await db!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",
        [instance,version[0].version_id]);
      await db!.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,$2,now(),'OPENING_CASH','GBP',10000)",
        [instance,account]);
    }
  });
  afterAll(async()=>{
    if(!db)return;
    if(user)await db.unsafe("DELETE FROM users WHERE id=$1",[user]);
    for(const line of lines){
      await db.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1",[line]);
      await db.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1",[line]);
      await db.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1",[line]);
      await db.unsafe("DELETE FROM trading_lines WHERE id=$1",[line]);
    }
    for(const instrument of instruments)await db.unsafe("DELETE FROM instruments WHERE id=$1",[instrument]);
    await db.end();
  });
  for(const [i,key] of keys.entries()){
    it(key+" produces a verified mapped cash-funded buy",async()=>{
      const result=await calculateAction(instances[i]);
      const rows=await db!.unsafe("SELECT action_type,amount,trading_line_id FROM actions WHERE id=$1",[result.actionId]);
      expect(rows).toHaveLength(1);
      expect(rows[0].action_type).toBe("BUY");
      expect(Number(rows[0].amount)).toBeCloseTo(key==="larry-portfolio"?7200:key==="bernstein-no-brainer"?2500:1500,2);
      expect(rows[0].trading_line_id).not.toBeNull();
    });
  }
});
