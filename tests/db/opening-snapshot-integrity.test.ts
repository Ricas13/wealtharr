import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import postgres from "postgres";

const caller=vi.hoisted(()=>({id:"",role:"USER",country:"GB",timezone:"Europe/London"}));
vi.mock("@/lib/session",()=>({requireUser:async()=>caller}));
const url=process.env.DATABASE_URL;
const db=url?postgres(url,{max:2,prepare:false}):null;
describe.skipIf(!url)("opening snapshot monetary integrity",()=>{
  let instanceId="",instrumentId="";
  const suffix=Math.random().toString(36).slice(2,10);
  const ticker="SN"+suffix.toUpperCase();
  beforeAll(async()=>{
    caller.id=String((await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",["snapshot-"+suffix+"@example.test"]))[0].id);
    const account=(await db!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'Snapshot','ISA','GB','GBP') RETURNING id",[caller.id]))[0];
    const instance=(await db!.unsafe("INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name,onboarding_mode,status) SELECT $1,$2,d.id,v.id,'Snapshot','RESUME','PAUSED' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id,strategy_version_id",[caller.id,account.id]))[0];
    instanceId=String(instance.id);
    await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[instanceId,account.id]);
    await db!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"resumeNeedsReconciliation\":true}'::jsonb)",[instanceId,instance.strategy_version_id]);
    instrumentId=String((await db!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'GBP') RETURNING id",[ticker]))[0].id);
    await db!.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London','2020-01-01')",[instrumentId,ticker]);
  });
  afterAll(async()=>{
    if(!db)return;
    if(caller.id)await db.unsafe("DELETE FROM users WHERE id=$1",[caller.id]);
    if(instrumentId){await db.unsafe("DELETE FROM trading_lines WHERE instrument_id=$1",[instrumentId]);await db.unsafe("DELETE FROM instruments WHERE id=$1",[instrumentId]);}
    await db.end();
  });
  async function snapshot(body:unknown){
    const {POST}=await import("@/app/api/strategies/[id]/opening-snapshot/route");
    return POST(new Request("http://127.0.0.1:3000/api/snapshot",{method:"POST",headers:{origin:"http://127.0.0.1:3000","content-type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({id:instanceId})});
  }
  it("rolls back cash and units if the same security is entered twice",async()=>{
    const response=await snapshot({cash:"100",holdings:[{ticker,exchange:"LSE",quantity:"2"},{ticker:ticker.toLowerCase(),exchange:"lse",quantity:"2"}]});
    expect(response.status).toBe(400);
    expect(await db!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1",[instanceId])).toHaveLength(0);
    expect((await db!.unsafe("SELECT state FROM strategy_states WHERE strategy_instance_id=$1",[instanceId]))[0].state.resumeNeedsReconciliation).toBe(true);
  });
  it("refuses cash that would be rounded by the database",async()=>{
    expect((await snapshot({cash:"0.000000001"})).status).toBe(400);
    expect(await db!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1",[instanceId])).toHaveLength(0);
  });
  it("records one reconciled snapshot and refuses a repeated submission",async()=>{
    const body={cash:"100.12345678",holdings:[{ticker,exchange:"LSE",quantity:"2.5"}]};
    expect((await snapshot(body)).status).toBe(200);
    expect((await snapshot(body)).status).toBe(409);
    const rows=await db!.unsafe("SELECT event_type,cash_amount::text,quantity::text FROM ledger_events WHERE strategy_instance_id=$1 ORDER BY event_type",[instanceId]);
    expect(rows).toEqual([
      {event_type:"OPENING_CASH",cash_amount:"100.12345678",quantity:"0.000000000000"},
      {event_type:"OPENING_POSITION",cash_amount:"0.00000000",quantity:"2.500000000000"}
    ]);
  });
});
