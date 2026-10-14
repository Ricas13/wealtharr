import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {getStrategyPlugin} from "@/domain/strategy/catalog";
import {calculateAction,executeAction} from "@/lib/action-service";

const dbUrl=process.env.DATABASE_URL;
const db=dbUrl?postgres(dbUrl,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
const broker="GROUP2_"+suffix.toUpperCase();
const keys=["all-weather","hfea","coffeehouse","core-four","swensen","merriman-ultimate"] as const;
const firstTargets:Record<(typeof keys)[number],{exposure:string;amount:number}>={
  "all-weather":{exposure:"LONG_TREASURY",amount:4000},
  "hfea":{exposure:"US_EQUITY_3X_LONG",amount:5500},
  "coffeehouse":{exposure:"US_INTERMEDIATE_TREASURY",amount:4000},
  "core-four":{exposure:"US_TOTAL_EQUITY",amount:4800},
  "swensen":{exposure:"US_TOTAL_EQUITY",amount:3000},
  "merriman-ultimate":{exposure:"US_LARGE_CAP",amount:1000}
};

describe.skipIf(!dbUrl)("Group 2 first-customer portfolio journeys (synthetic markets only)",()=>{
 let userId="";
 const instrumentIds:string[]=[];
 const lineIds:string[]=[];
 const instanceIds=new Map<string,string>();
 const tickers=new Map<string,string>();

 beforeAll(async()=>{
   const all=new Set<string>();
   for(const key of keys){
     const allocations=getStrategyPlugin(key)?.profile?.config?.allocations as Array<{exposure:string;weight:string}>;
     for(const entry of allocations)all.add(entry.exposure);
   }
   let sequence=0;
   for(const exposure of all){
     const ticker="G2"+(++sequence)+"_"+suffix;
     const leverage=exposure.endsWith("_3X_LONG")?3:1;
     const ins=await db!.unsafe(
       "INSERT INTO instruments(name,economic_exposure,leverage,fund_currency) VALUES ($1,$2,$3,'USD') RETURNING id",
       ["Synthetic Group 2 "+ticker,exposure,leverage]
     );
     instrumentIds.push(String(ins[0].id));
     const tl=await db!.unsafe(
       "INSERT INTO trading_lines(instrument_id,ticker,exchange,currency,exchange_timezone,provider_symbol,effective_from) "+
       "VALUES ($1,$2,'NYSE','USD','America/New_York',$2,'2020-01-01') RETURNING id",
       [ins[0].id,ticker]
     );
     lineIds.push(String(tl[0].id));
     tickers.set(exposure,ticker);
     await db!.unsafe(
       "INSERT INTO regional_instrument_mappings(economic_exposure,leverage,direction,country,wrapper,broker,trading_line_id,fidelity,effective_from,enabled) "+
       "VALUES ($1,$2,'LONG','US','TAXABLE',$3,$4,'EXACT','2020-01-01',true)",
       [exposure,leverage,broker,tl[0].id]
     );
     await db!.unsafe(
       "INSERT INTO market_data_observations(trading_line_id,observed_at,price,currency,provider,freshness) "+
       "VALUES ($1,now(),100,'USD','group2-synthetic','CURRENT')",[tl[0].id]
     );
   }
   const usr=await db!.unsafe(
     "INSERT INTO users(email,password_hash,country,base_currency) VALUES ($1,'x','US','USD') RETURNING id",
     ["group2-"+suffix+"@example.test"]
   );
   userId=String(usr[0].id);
   for(const key of keys){
     const acct=await db!.unsafe(
       "INSERT INTO accounts(user_id,name,wrapper,country,currency,broker_name) VALUES ($1,$2,'TAXABLE','US','USD',$3) RETURNING id",
       [userId,"Group2 "+key,broker]
     );
     const version=await db!.unsafe(
       "SELECT d.id AS definition_id,v.id AS version_id FROM strategy_definitions d "+
       "JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
       "WHERE d.key=$1 AND v.version='1.0' LIMIT 1",[key]
     );
     if(!version[0])throw new Error("GROUP2_CI_SEED_MISSING:"+key);
     const ins=await db!.unsafe(
       "INSERT INTO strategy_instances(user_id,account_id,strategy_definition_id,strategy_version_id,name) "+
       "VALUES ($1,$2,$3,$4,$5) RETURNING id",
       [userId,acct[0].id,version[0].definition_id,version[0].version_id,"Group2 "+key]
     );
     const instanceId=String(ins[0].id);
     instanceIds.set(key,instanceId);
     await db!.unsafe("INSERT INTO strategy_accounts(strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",
       [instanceId,acct[0].id]);
     await db!.unsafe(
       "INSERT INTO strategy_states(strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",
       [instanceId,version[0].version_id]
     );
     await db!.unsafe(
       "INSERT INTO ledger_events(strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) "+
       "VALUES ($1,$2,now(),'OPENING_CASH','USD',10000)",[instanceId,acct[0].id]
     );
   }
 });

 afterAll(async()=>{
   if(!db)return;
   if(userId)await db.unsafe("DELETE FROM users WHERE id=$1",[userId]);
   for(const id of lineIds){
     await db.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id=$1",[id]);
     await db.unsafe("DELETE FROM market_data_observations WHERE trading_line_id=$1",[id]);
     await db.unsafe("UPDATE actions SET trading_line_id=NULL WHERE trading_line_id=$1",[id]);
     await db.unsafe("DELETE FROM trading_lines WHERE id=$1",[id]);
   }
   for(const id of instrumentIds)await db.unsafe("DELETE FROM instruments WHERE id=$1",[id]);
   await db.end();
 });

 for(const key of keys){
   it(key+" calculates the first real trade only with full synthetic EXACT mappings",async()=>{
     const id=instanceIds.get(key)!;
     const calc=await calculateAction(id);
     const row=(await db!.unsafe(
       "SELECT a.action_type,a.amount,tl.ticker FROM actions a LEFT JOIN trading_lines tl ON tl.id=a.trading_line_id WHERE a.id=$1",
       [calc.actionId]
     ))[0];
     expect(row.action_type).toBe("BUY");
     expect(Number(row.amount)).toBe(firstTargets[key].amount);
     expect(row.ticker).toBe(tickers.get(firstTargets[key].exposure));
   });
 }

 it("HFEA posts broker-confirmed fills and recalculates the subsequent action",async()=>{
   const id=instanceIds.get("hfea")!;
   const first=await calculateAction(id);
   const done=await executeAction(userId,first.actionId,{price:"100",quantity:"55",fee:"0"});
   const next=done.actionId??(await calculateAction(id)).actionId;
   const row=(await db!.unsafe("SELECT a.action_type,a.amount FROM actions a WHERE a.id=$1",[next]))[0];
   expect(row.action_type).toBe("BUY");
   expect(Number(row.amount)).toBe(4500);
   const events=await db!.unsafe("SELECT quantity,cash_amount FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='BUY'",[id]);
   expect(events).toHaveLength(1);
   expect(Number(events[0].quantity)).toBe(55);
   expect(Number(events[0].cash_amount)).toBe(-5500);
 });
});
