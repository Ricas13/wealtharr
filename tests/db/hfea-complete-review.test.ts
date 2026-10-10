import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {calculateAction,executeAction} from "@/lib/action-service";

const dbUrl=process.env.DATABASE_URL;
const db=dbUrl?postgres(dbUrl,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
describe.skipIf(!dbUrl)("HFEA full quarterly review with real broker fills",()=>{
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
    ["hfea-complete-"+suffix+"@example.test"]);userId=String(user[0].id);
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
 it("buys the 55/45 sleeves sequentially, then confirms HOLD before ending the quarter",async()=>{
  const first=await calculateAction(instanceId);
  const firstAction=await actionRow(first.actionId);
  expect(firstAction.action_type).toBe("BUY");
  expect(firstAction.ticker).toBe("HFEQ"+suffix);
  expect(Number(firstAction.amount)).toBe(5500);
  const filledFirst=await executeAction(userId,first.actionId,{price:"100",quantity:"55",fee:"0"});
  const stateAfterFirst=(await db!.unsafe("SELECT state FROM strategy_states WHERE strategy_instance_id=$1",[instanceId]))[0].state;
  expect(stateAfterFirst.forceReview).toBe(true);
  expect(stateAfterFirst.lastReviewAt).toBeUndefined();

  const secondId=filledFirst.actionId??(await calculateAction(instanceId)).actionId;
  const secondAction=await actionRow(secondId);
  expect(secondAction.action_type).toBe("BUY");
  expect(secondAction.ticker).toBe("HFTM"+suffix);
  expect(Number(secondAction.amount)).toBe(4500);
  const filledSecond=await executeAction(userId,secondId,{price:"100",quantity:"45",fee:"0"});
  const stateAfterSecond=(await db!.unsafe("SELECT state FROM strategy_states WHERE strategy_instance_id=$1",[instanceId]))[0].state;
  expect(stateAfterSecond.forceReview).toBe(true);
  expect(stateAfterSecond.lastReviewAt).toBeUndefined();

  const holdId=filledSecond.actionId??(await calculateAction(instanceId)).actionId;
  expect((await actionRow(holdId)).action_type).toBe("HOLD");
  await executeAction(userId,holdId);
  const finished=(await db!.unsafe("SELECT state FROM strategy_states WHERE strategy_instance_id=$1",[instanceId]))[0].state;
  expect(finished.forceReview).toBe(false);
  expect(new Date(finished.lastReviewAt).getTime()).toBeGreaterThan(0);
  const ledger=await db!.unsafe("SELECT event_type,quantity,cash_amount FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='BUY' ORDER BY occurred_at,created_at",[instanceId]);
  expect(ledger.map(row=>Number(row.quantity))).toEqual([55,45]);
  expect(ledger.map(row=>Number(row.cash_amount))).toEqual([-5500,-4500]);
  const next=await calculateAction(instanceId);
  expect((await actionRow(next.actionId)).action_type).toBe("NO_ACTION");
 });
});
