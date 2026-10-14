import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {calculateAction,executeAction} from "@/lib/action-service";

const dbUrl=process.env.DATABASE_URL;
const db=dbUrl?postgres(dbUrl,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
// A GBP stocks-and-shares ISA with whole shares only and NON-round prices, using the 55/45 fixed
// allocation (rebalance threshold 0.00). Orders are sized to the nearest whole share; once every leg is within
// half a share of its target the review closes with a confirmed HOLD (execution convention).
describe.skipIf(!dbUrl)("fixed allocation whole-share review closes within half a share of target",()=>{
 let userId="",accountId="",instanceId="";
 const ids:string[]=[];
 const lineIds:string[]=[];
 async function actionRow(id:string){
  return (await db!.unsafe("SELECT a.action_type,a.amount,a.explanation,a.due_at,tl.ticker FROM actions a LEFT JOIN trading_lines tl ON tl.id=a.trading_line_id WHERE a.id=$1",[id]))[0];
 }
 async function state(){
  return (await db!.unsafe("SELECT state FROM strategy_states WHERE strategy_instance_id=$1",[instanceId]))[0].state;
 }
 beforeAll(async()=>{
  for(const [exposure,ticker,price] of [["US_EQUITY_3X_LONG","RSQE"+suffix,"91.70"],["LONG_TREASURY_3X_LONG","RSQB"+suffix,"44.40"]]){
   const ins=await db!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,3,'GBP') RETURNING id",
    ["Fixture "+ticker,exposure]);ids.push(String(ins[0].id));
   const line=await db!.unsafe(
    "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) "+
    "VALUES ($1,$2,'LSE','GBP','Europe/London',$2,'2020-01-01') RETURNING id",
    [ins[0].id,ticker]);
   const lineId=String(line[0].id);lineIds.push(lineId);
   await db!.unsafe(
    "INSERT INTO regional_instrument_mappings (economic_exposure,leverage,country,wrapper,trading_line_id,fidelity,effective_from,enabled) "+
    "VALUES ($1,3,'GB','ISA',$2,'EXACT','2020-01-01',true)",[exposure,lineId]);
   await db!.unsafe(
    "INSERT INTO market_data_observations (trading_line_id,observed_at,price,currency,provider,freshness) "+
    "VALUES ($1,now(),$2,'GBP','residue-fixture','CURRENT')",[lineId,price]);
  }
  const user=await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",
    ["whole-share-"+suffix+"@example.test"]);userId=String(user[0].id);
  const account=await db!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'Stocks and shares ISA','ISA','GB','GBP') RETURNING id",[userId]);
  accountId=String(account[0].id);
  const instance=await db!.unsafe(
    "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name,execution_constraints) "+
    "SELECT $1,$2,d.id,v.id,'Whole share review test','{\"fractionalShares\":false,\"minimumTradeAmount\":\"0\",\"cashBufferAmount\":\"0\",\"flatFee\":\"0\",\"allowSelling\":true}'::jsonb "+
    "FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
    "WHERE d.key='hfea' AND v.version='1.0' LIMIT 1 RETURNING id,strategy_version_id",
    [userId,accountId]);instanceId=String(instance[0].id);
  await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[instanceId,accountId]);
  await db!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",[instanceId,instance[0].strategy_version_id]);
  await db!.unsafe(
    "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) "+
    "VALUES ($1,$2,now(),'OPENING_CASH','GBP',10000)",[instanceId,accountId]);
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
 it("buys whole shares, fills, then closes the review on the residue HOLD",async()=>{
  // Cash 10000, targets 55% = 5500 and 45% = 4500, threshold 0.
  // Orders are sized to the NEAREST whole share: equity at 91.70: 5500 / 91.70 = 59.98 -> 60 shares = 5502.00
  // (2.00 over the target; half a share is 45.85, so the leg is at target afterwards).
  const first=await calculateAction(instanceId);
  const firstAction=await actionRow(first.actionId);
  expect(firstAction.action_type).toBe("BUY");
  expect(firstAction.ticker).toBe("RSQE"+suffix);
  expect(Number(firstAction.amount)).toBeCloseTo(5502.00,2);
  const filledFirst=await executeAction(userId,first.actionId,{price:"91.70",quantity:"60",fee:"0"});
  const afterFirst=await state();
  expect(afterFirst.forceReview).toBe(true);
  expect(afterFirst.lastReviewAt).toBeUndefined();

  // Cash 10000 - 5502.00 = 4498.00. Bonds at 44.40: 4500 / 44.40 = 101.35 -> 101 shares = 4484.40 (15.60 under,
  // inside half a share = 22.20), affordable from 4498.00.
  const secondId=filledFirst.actionId??(await calculateAction(instanceId)).actionId;
  const secondAction=await actionRow(secondId);
  expect(secondAction.action_type).toBe("BUY");
  expect(secondAction.ticker).toBe("RSQB"+suffix);
  expect(Number(secondAction.amount)).toBeCloseTo(4484.40,2);
  const filledSecond=await executeAction(userId,secondId,{price:"44.40",quantity:"101",fee:"0"});
  const afterSecond=await state();
  expect(afterSecond.forceReview).toBe(true);
  expect(afterSecond.lastReviewAt).toBeUndefined();

  // Cash 4498.00 - 4484.40 = 13.60. Equity is 2.00 over its 5500 target and bonds 15.60 under 4500: both inside
  // half a share (45.85 / 22.20), so every leg is at target and the review proposes a HOLD that records them.
  const holdId=filledSecond.actionId??(await calculateAction(instanceId)).actionId;
  const hold=await actionRow(holdId);
  expect(hold.action_type).toBe("HOLD");
  const rows=hold.explanation as Array<{label:string;value:string}>;
  expect(rows.find(row=>row.label==="Residual cash")?.value).toBe("13.60");
  expect(rows.find(row=>row.label==="Residual drift US_EQUITY_3X_LONG")?.value).toContain("over target by 2.00");
  expect(rows.find(row=>row.label==="Residual drift LONG_TREASURY_3X_LONG")?.value).toContain("under target by 15.60");

  const beforeClose=Date.now();
  await executeAction(userId,holdId);
  const finished=await state();
  expect(finished.forceReview).toBe(false);
  const closedAt=new Date(finished.lastReviewAt).getTime();
  expect(closedAt).toBeGreaterThanOrEqual(beforeClose-5000);

  const ledger=await db!.unsafe("SELECT quantity,cash_amount FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='BUY' ORDER BY occurred_at,created_at",[instanceId]);
  expect(ledger.map(row=>Number(row.quantity))).toEqual([60,101]);
  expect(ledger.map(row=>Number(row.cash_amount))).toEqual([-5502,-4484.4]);

  // The review is closed: the next calculation is NO_ACTION and the next review is a future quarter end.
  const next=await calculateAction(instanceId);
  const nextAction=await actionRow(next.actionId);
  expect(nextAction.action_type).toBe("NO_ACTION");
  const due=new Date(nextAction.due_at);
  expect(due.getTime()).toBeGreaterThan(closedAt);
  expect([3,6,9,12]).toContain(due.getUTCMonth()+1);
 });
});
