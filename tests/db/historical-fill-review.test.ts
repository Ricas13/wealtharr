import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import postgres from "postgres";
import {executeAction} from "@/lib/action-service";

const caller=vi.hoisted(()=>({id:"",role:"USER",country:"US",timezone:"America/New_York"}));
vi.mock("@/lib/session",()=>({requireUser:async()=>caller}));
const dbUrl=process.env.DATABASE_URL;
const db=dbUrl?postgres(dbUrl,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
describe.skipIf(!dbUrl)("historical broker imports preserve the initial review",()=>{
 let userId="",accountId="",instanceId="";
 const ids:string[]=[];
 const lineIds:string[]=[];
 async function actionRow(id:string){
  return (await db!.unsafe("SELECT a.action_type,a.amount,tl.ticker FROM actions a LEFT JOIN trading_lines tl ON tl.id=a.trading_line_id WHERE a.id=$1",[id]))[0];
 }
 beforeAll(async()=>{
  for(const [exposure,ticker] of [["US_EQUITY_3X_LONG","HFEQ"+suffix],["LONG_TREASURY_3X_LONG","HFTM"+suffix]]){
   const ins=await db!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,3,'USD') RETURNING id",
    ["Fixture "+ticker,exposure]);ids.push(String(ins[0].id));
   const line=await db!.unsafe(
    "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) "+
    "VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01') RETURNING id",
    [ins[0].id,ticker]);
   const lineId=String(line[0].id);lineIds.push(lineId);
   await db!.unsafe(
    "INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,effective_from,enabled) "+
    "VALUES ($1,3,'US','TAXABLE',$2,'2020-01-01',true)",[exposure,lineId]);
   await db!.unsafe(
    "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) "+
    "VALUES ($1,now(),100,'USD','hfea-fixture','CURRENT')",[lineId]);
  }
  const user=await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",
    ["hfea-import-"+suffix+"@example.test"]);userId=String(user[0].id);caller.id=userId;
  const account=await db!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'US brokerage','TAXABLE','US','USD') RETURNING id",[userId]);
  accountId=String(account[0].id);
  const instance=await db!.unsafe(
    "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) "+
    "SELECT $1,$2,d.id,v.id,'HFEA review test' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
    "WHERE d.key='hfea' AND v.version='1.0' LIMIT 1 RETURNING id,strategy_version_id",
    [userId,accountId]);instanceId=String(instance[0].id);
  await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[instanceId,accountId]);
  await db!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",[instanceId,instance[0].strategy_version_id]);
  await db!.unsafe(
    "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) "+
    "VALUES ($1,$2,now(),'OPENING_CASH','USD',10000)",[instanceId,accountId]);
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
 it("keeps both 55/45 legs open until HOLD, then recovers retries without another fill",async()=>{
  const {POST}=await import("@/app/api/strategies/[id]/trades/route");
  const origin=process.env.NEXT_PUBLIC_APP_URL??"http://localhost:3000";
  const firstFill={accountId,ticker:"HFEQ"+suffix,exchange:"NYSE",executedAt:new Date().toISOString(),
    side:"BUY",quantity:"55",unitPrice:"100",fee:"0",requestKey:crypto.randomUUID(),brokerFillConfirmed:true};
  const send=(body:typeof firstFill)=>POST(new Request(origin+"/api/strategies/"+instanceId+"/trades",{
    method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)
  }),{params:Promise.resolve({id:instanceId})});
  // Even a one-unit overdraft at the persisted 8-decimal cash scale is invalid.
  const overdrawn=await send({...firstFill,fee:"4500.00000001",requestKey:crypto.randomUUID()});
  expect(overdrawn.status).toBe(409);
  expect((await overdrawn.json()).error).toContain("cash would be negative");
  expect(await db!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='BUY'",[instanceId])).toHaveLength(0);
  const first=await send(firstFill);
  expect(first.status).toBe(200);
  const saved=await first.json();
  const state=(await db!.unsafe("SELECT state FROM strategy_states WHERE strategy_instance_id=$1",[instanceId]))[0].state;
  expect(state.lastReviewAt).toBeUndefined();
  expect(state.forceReview).toBe(true);
  const second=await actionRow(saved.actionId);
  expect(second.action_type).toBe("BUY");
  expect(second.ticker).toBe("HFTM"+suffix);
  // $10,000 * 45% = $4,500 still required after the imported $5,500 equity fill.
  expect(Number(second.amount)).toBe(4500);
  const secondResponse=await send({...firstFill,ticker:"HFTM"+suffix,quantity:"45",
    executedAt:new Date().toISOString(),requestKey:crypto.randomUUID()});
  expect(secondResponse.status).toBe(200);
  const hold=(await secondResponse.json()).actionId;
  expect((await actionRow(hold)).action_type).toBe("HOLD");
  await executeAction(userId,hold);
  const finished=(await db!.unsafe("SELECT state FROM strategy_states WHERE strategy_instance_id=$1",[instanceId]))[0].state;
  expect(finished.forceReview).toBe(false);
  expect(new Date(finished.lastReviewAt).getTime()).toBeGreaterThanOrEqual(new Date(firstFill.executedAt).getTime());
  const retry=await send(firstFill);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({eventId:saved.eventId,duplicate:true});
  const conflict=await send({...firstFill,quantity:"54"});
  expect(conflict.status).toBe(409);
  const backdated=await send({...firstFill,requestKey:crypto.randomUUID()});
  expect(backdated.status).toBe(409);
  expect((await backdated.json()).error).toContain("predates a completed review");
  await db!.unsafe("UPDATE strategy_instances SET status='CLOSED' WHERE id=$1",[instanceId]);
  const closedRetry=await send(firstFill);
  expect(closedRetry.status).toBe(200);
  expect(await closedRetry.json()).toMatchObject({eventId:saved.eventId,duplicate:true});
  expect((await send({...firstFill,requestKey:crypto.randomUUID()})).status).toBe(409);
  const ledger=await db!.unsafe("SELECT quantity,cash_amount FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='BUY' ORDER BY occurred_at,created_at",[instanceId]);
  expect(ledger.map(row=>Number(row.quantity))).toEqual([55,45]);
  expect(ledger.map(row=>Number(row.cash_amount))).toEqual([-5500,-4500]);
 });
});
