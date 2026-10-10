import {afterAll,beforeAll,beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import postgres from "postgres";
import * as actionService from "@/lib/action-service";
import * as email from "@/lib/email";
import {createPendingDeliveries,processDeliveryBacklog} from "@/lib/notification-service";

const caller=vi.hoisted(()=>({id:"",role:"USER",country:"US",timezone:"America/New_York"}));
vi.mock("@/lib/session",()=>({requireUser:async()=>caller}));
const dbUrl=process.env.DATABASE_URL;
const db=dbUrl?postgres(dbUrl,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
describe.skipIf(!dbUrl)("action alerts revalidate current financial inputs",()=>{
 let userId="",accountId="",instanceId="";
 const ids:string[]=[];
 const lineIds:string[]=[];
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
    ["hfea-alert-"+suffix+"@example.test"]);userId=String(user[0].id);caller.id=userId;
  await db!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) SELECT $1,id,'ACTIVE','MONTHLY' FROM plans WHERE slug='pro'",[userId]);
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
 const messages:string[]=[];
 beforeEach(async()=>{
  await db!.unsafe("DELETE FROM notifications WHERE user_id=$1",[userId]);
  await db!.unsafe("DELETE FROM actions WHERE strategy_instance_id=$1",[instanceId]);
  await db!.unsafe("DELETE FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='CONTRIBUTION'",[instanceId]);
  await db!.unsafe("UPDATE strategy_instances SET status='ACTIVE' WHERE id=$1",[instanceId]);
  await db!.unsafe("UPDATE market_data_observations SET observed_at=now() WHERE trading_line_id=ANY($1::uuid[])",[lineIds]);
  await db!.unsafe("UPDATE regional_instrument_mappings SET enabled=true WHERE trading_line_id=ANY($1::uuid[])",[lineIds]);
  messages.length=0;
  vi.spyOn(email,"getEmailProvider").mockReturnValue({send:async(message)=>{messages.push(message.text);return true;}});
 });
 afterEach(()=>vi.restoreAllMocks());
 async function queue(){
  await actionService.calculateAction(instanceId);
  await createPendingDeliveries(200);
  return String((await db!.unsafe("SELECT id FROM notifications WHERE user_id=$1",[userId]))[0].id);
 }
 async function delivery(id:string){
  return (await db!.unsafe("SELECT status,last_error_code,attempt_count FROM notification_deliveries WHERE notification_id=$1 AND channel='EMAIL'",[id]))[0];
 }
 it("sends the revised amount after an un-recalculated deposit, never the queued amount",async()=>{
  const id=await queue();
  expect((await db!.unsafe("SELECT body FROM notifications WHERE id=$1",[id]))[0].body).toContain("5500.00 USD");
  await db!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,$2,now(),'CONTRIBUTION','USD',10000)",[instanceId,accountId]);
  await processDeliveryBacklog({budgetMs:10000});
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("11000.00 USD");
  expect(messages[0]).not.toContain("5500.00 USD");
  expect(await delivery(id)).toMatchObject({status:"SENT"});
 });
 it("suppresses a queued buy once its price becomes stale",async()=>{
  const id=await queue();
  const actionId=String((await db!.unsafe("SELECT action_id FROM notifications WHERE id=$1",[id]))[0].action_id);
  expect(await actionService.isStoredActionCurrent(instanceId,actionId)).toBe(true);
  await db!.unsafe("UPDATE market_data_observations SET observed_at=now()-interval '3 days' WHERE trading_line_id=ANY($1::uuid[])",[lineIds]);
  expect(await actionService.isStoredActionCurrent(instanceId,actionId)).toBe(false);
  await expect(actionService.executeAction(userId,actionId,{price:"100",quantity:"55",fee:"0"})).rejects.toThrow("ACTION_STALE_INPUTS");
  expect(await db!.unsafe("SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='BUY'",[instanceId])).toHaveLength(0);
  await processDeliveryBacklog({budgetMs:10000});
  expect(messages).toEqual([]);
  expect(await delivery(id)).toMatchObject({status:"CANCELLED",last_error_code:"ACTION_NO_LONGER_CURRENT"});
  expect((await db!.unsafe("SELECT action_type FROM actions WHERE strategy_instance_id=$1 AND status='CALCULATED'",[instanceId]))[0].action_type).toBe("DATA_REQUIRED");
 });
 it.each(["PAUSED","CLOSED"])("suppresses queued instructions for a %s strategy",async(status)=>{
  const id=await queue();
  await db!.unsafe("UPDATE strategy_instances SET status=$1 WHERE id=$2",[status,instanceId]);
  await processDeliveryBacklog({budgetMs:10000});
  expect(messages).toEqual([]);
  expect(await delivery(id)).toMatchObject({status:"CANCELLED",last_error_code:"ACTION_NO_LONGER_CURRENT"});
 });
 it("suppresses a queued trade after the regional mapping is disabled",async()=>{
  const id=await queue();
  const actionId=String((await db!.unsafe("SELECT action_id FROM notifications WHERE id=$1",[id]))[0].action_id);
  await db!.unsafe("UPDATE regional_instrument_mappings SET enabled=false WHERE trading_line_id=ANY($1::uuid[])",[lineIds]);
  expect(await actionService.isStoredActionCurrent(instanceId,actionId)).toBe(false);
  await expect(actionService.executeAction(userId,actionId,{price:"100",quantity:"55",fee:"0"})).rejects.toThrow("ACTION_STALE_INPUTS");
  await processDeliveryBacklog({budgetMs:10000});
  expect(messages).toEqual([]);
  expect(await delivery(id)).toMatchObject({status:"CANCELLED"});
 });
 it("retries a failed revalidation without sending stale instructions or exposing errors",async()=>{
  const id=await queue();
  const calculate=vi.spyOn(actionService,"calculateAction").mockRejectedValue(new Error("private-database-detail"));
  await processDeliveryBacklog({budgetMs:10000});
  expect(messages).toEqual([]);
  expect(await delivery(id)).toMatchObject({status:"PENDING",attempt_count:1,last_error_code:"ACTION_REVALIDATION_FAILED"});
  calculate.mockRestore();
  await db!.unsafe("UPDATE notification_deliveries SET next_attempt_at=now()-interval '1 second' WHERE notification_id=$1",[id]);
  await processDeliveryBacklog({budgetMs:10000});
  expect(messages).toHaveLength(1);
  expect(await delivery(id)).toMatchObject({status:"SENT",attempt_count:2,last_error_code:null});
 });
 it("releases the claim without a charged retry when revalidation exhausts the budget",async()=>{
  const id=await queue();
  let clock=Date.now();
  const actual=actionService.calculateAction;
  const now=vi.spyOn(Date,"now").mockImplementation(()=>clock);
  const calculate=vi.spyOn(actionService,"calculateAction").mockImplementation(async(id)=>{
    const result=await actual(id);clock+=200;return result;
  });
  expect(await processDeliveryBacklog({budgetMs:100})).toMatchObject({sent:0,exhausted:false});
  expect(messages).toEqual([]);
  expect(await delivery(id)).toMatchObject({status:"PENDING",attempt_count:0});
  now.mockRestore();calculate.mockRestore();
  await processDeliveryBacklog({budgetMs:10000});
  expect(messages).toHaveLength(1);
  expect(await delivery(id)).toMatchObject({status:"SENT",attempt_count:1});
 });
});
