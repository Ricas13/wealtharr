import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {calculateAction,executeAction} from "@/lib/action-service";

/**
 * End-to-end: a quarterly target strategy in a UK ISA held in GBP, through the real calculation,
 * order sizing and broker-fill paths. Guards two defects found in review (2026-10-16):
 *  - orders were labelled in the USD reference currency, so every fill in a GBP account was refused;
 *  - a cash buffer was offered to the engine as spendable cash, so the review could never close.
 * Hand-computed values: opening cash 10000, buffer 100 -> 9900 belongs to the strategy;
 * 60% = 5940 into the 3x Nasdaq exposure, then a 2 GBP first-fill fee leaves 3958 spendable.
 * The safe-sleeve purchase is 3956 with its own 2 GBP fee, preserving 100 GBP of cash.
 */
const dbUrl=process.env.DATABASE_URL;
const db=dbUrl?postgres(dbUrl,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
describe.skipIf(!dbUrl)("quarterly target strategy in a GBP ISA, start to first completed review",()=>{
 let userId="",accountId="",instanceId="";
 const instrumentIds:string[]=[];
 const lineIds:string[]=[];
 async function actionRow(id:string){
  return (await db!.unsafe("SELECT a.action_type,a.amount,a.currency,a.title,tl.ticker FROM actions a LEFT JOIN trading_lines tl ON tl.id=a.trading_line_id WHERE a.id=$1",[id]))[0];
 }
 beforeAll(async()=>{
  for(const [exposure,leverage,ticker] of [["NASDAQ_100_3X_LONG","3","QQ3"+suffix],["US_AGGREGATE_BONDS","1","AGG"+suffix]]){
   const ins=await db!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,$3,'USD') RETURNING id",
    ["Fixture "+ticker,exposure,leverage]);instrumentIds.push(String(ins[0].id));
   const line=await db!.unsafe(
    "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) "+
    "VALUES ($1,$2,'LSE','GBP','Europe/London',$2,'2020-01-01') RETURNING id",[ins[0].id,ticker]);
   const lineId=String(line[0].id);lineIds.push(lineId);
   await db!.unsafe(
    "INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) "+
    "VALUES ($1,$2,'GB','ISA',$3,'EXACT','2020-01-01',true)",[exposure,leverage,lineId]);
   await db!.unsafe(
    "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) "+
    "VALUES ($1,now(),100,'GBP','quarterly-fixture','CURRENT')",[lineId]);
  }
  // The signal history of the risk exposure comes from its US listing (reference currency USD): flat
  // licensed, adjustment-verified weekday closes over the last 34 months, so no spike and no 30 Down.
  const usLine=await db!.unsafe(
   "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) "+
   "VALUES ($1,$2,'NASDAQ','USD','America/New_York',$2,'2020-01-01') RETURNING id",[instrumentIds[0],"TQ"+suffix]);
  lineIds.push(String(usLine[0].id));
  await db!.unsafe(
   "INSERT INTO price_history (trading_line_id,trading_day,adjusted_close,currency,provider,licensed,adjustment_verified) "+
   "SELECT $1,d::date,50,'USD','quarterly-fixture',true,true FROM generate_series(current_date-interval '34 months',current_date,interval '1 day') d "+
   "WHERE extract(isodow FROM d)<6",[usLine[0].id]);

  const user=await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",
   ["quarterly-gbp-"+suffix+"@example.test"]);userId=String(user[0].id);
  const account=await db!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'UK ISA','ISA','GB','GBP') RETURNING id",[userId]);
  accountId=String(account[0].id);
  const instance=await db!.unsafe(
   "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name,execution_constraints) "+
   "SELECT $1,$2,d.id,v.id,'Quarterly GBP test','{\"cashBufferAmount\":\"100\",\"flatFee\":\"2\"}'::jsonb FROM strategy_definitions d "+
   "JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
   "WHERE d.key='quarterly-target-nasdaq-3x' AND v.lifecycle_status='PUBLISHED' ORDER BY v.effective_from DESC LIMIT 1 RETURNING id,strategy_version_id",
   [userId,accountId]);instanceId=String(instance[0].id);
  await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[instanceId,accountId]);
  await db!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",[instanceId,instance[0].strategy_version_id]);
  await db!.unsafe(
   "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) "+
   "VALUES ($1,$2,now()-interval '1 minute','OPENING_CASH','GBP',10000)",[instanceId,accountId]);
 });
 afterAll(async()=>{
  if(!db)return;
  if(userId)await db.unsafe("DELETE FROM users WHERE id=$1",[userId]);
  for(const lineId of lineIds){
   await db.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1",[lineId]);
   await db.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1",[lineId]);
   await db.unsafe("DELETE FROM price_history WHERE trading_line_id=$1",[lineId]);
   await db.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1",[lineId]);
   await db.unsafe("DELETE FROM trading_lines WHERE id=$1",[lineId]);
  }
  for(const id of instrumentIds)await db.unsafe("DELETE FROM instruments WHERE id=$1",[id]);
  await db.end();
 });
 it("sizes in GBP, keeps the cash buffer, records both fills and closes the first review",async()=>{
  const first=await calculateAction(instanceId);
  const buy=await actionRow(first.actionId);
  expect([buy.action_type,buy.currency,buy.ticker,Number(buy.amount)]).toEqual(["BUY","GBP","QQ3"+suffix,5940]);
  const afterBuy=await executeAction(userId,first.actionId,{price:"100",quantity:"59.4",fee:"2"});

  const sweepId=afterBuy.actionId??(await calculateAction(instanceId)).actionId;
  const sweep=await actionRow(sweepId);
  expect([sweep.action_type,sweep.currency,sweep.ticker,Number(sweep.amount)]).toEqual(["BUY","GBP","AGG"+suffix,3956]);
  const afterSweep=await executeAction(userId,sweepId,{price:"100",quantity:"39.56",fee:"2"});

  const holdId=afterSweep.actionId??(await calculateAction(instanceId)).actionId;
  expect((await actionRow(holdId)).action_type).toBe("HOLD");
  await executeAction(userId,holdId);
  const state=(await db!.unsafe("SELECT state FROM strategy_states WHERE strategy_instance_id=$1",[instanceId]))[0].state;
  expect(state.sigConfirmedAnchor).toBe("5940");
  expect(state.forceReview).toBe(false);
  expect(typeof state.sigLastReviewedReference).toBe("string");
  expect(Object.keys(state).filter((key:string)=>key.startsWith("sigReview"))).toEqual([]);

  const cash=(await db!.unsafe("SELECT sum(cash_amount)::numeric AS cash FROM ledger_events WHERE strategy_instance_id=$1",[instanceId]))[0].cash;
  expect(Number(cash)).toBe(100);
  // Between quarter ends, with flat verified daily closes: nothing to do (no spike reset).
  const next=await calculateAction(instanceId);
  expect((await actionRow(next.actionId)).action_type).toBe("NO_ACTION");
 });
});
