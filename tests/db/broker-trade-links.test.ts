import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:1,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,11);
const users:string[]=[];
const strategies:string[]=[];
const accounts:string[]=[];
const buys:string[]=[];
let contribution="";
let instrument="";
const externalAccount="T212_ACCOUNT_"+suffix;

describe.skipIf(!url)("strategy-scoped Trading 212 confirmed-trade claims",()=>{
 beforeAll(async()=>{
   const row=await sql!.unsafe("INSERT INTO instruments (name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,'BROAD_EQUITY',1,'LONG','GBP') RETURNING id",["Test broker claim "+suffix]);
   instrument=String(row[0].id);
   for(let i=0;i<3;i++){
     const userIndex=i===2?1:0;
     let userId=users[userIndex];
     if(!userId){
       const u=await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",["broker-claim-"+suffix+"-"+userIndex+"@example.test"]);
       userId=String(u[0].id);users.push(userId);
     }
     const a=await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,$2,'ISA','GB','GBP') RETURNING id",[userId,"Claim "+i]);
     accounts.push(String(a[0].id));
     const st=await sql!.unsafe(
       "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) "+
       "SELECT $1,$2,d.id,v.id,$3 FROM strategy_definitions d "+
       "JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
       "WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id",
       [userId,accounts[i],"Test claim "+i]
     );
     if(!st[0])throw new Error("SYNTHETIC_CI_STRATEGY_FIXTURE_MISSING");
     strategies.push(String(st[0].id));
     await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[strategies[i],accounts[i]]);
     const funding=await sql!.unsafe(
       "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance) "+
       "VALUES ($1,$2,now()-interval '1 day','CONTRIBUTION','GBP',100,'USER_CONFIRMED') RETURNING id",
       [strategies[i],accounts[i]]
     );
     if(i===0)contribution=String(funding[0].id);
     const trade=await sql!.unsafe(
       "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,unit_price,provenance) "+
       "VALUES ($1,$2,now(),'BUY','GBP',-10,$3,1,10,'USER_CONFIRMED') RETURNING id",
       [strategies[i],accounts[i],instrument]
     );
     buys.push(String(trade[0].id));
   }
 });
 afterAll(async()=>{
   if(!sql)return;
   for(const u of users)await sql.unsafe("DELETE FROM users WHERE id=$1",[u]);
   if(instrument)await sql.unsafe("DELETE FROM instruments WHERE id=$1",[instrument]);
   await sql.end();
 });
 it("links only a confirmed BUY/SELL in the matching user's linked strategy account",async()=>{
   const link=await sql!.unsafe(
     "INSERT INTO broker_trade_links (user_id,strategy_instance_id,account_id,ledger_event_id,provider,external_account_ref,external_trade_id) "+
     "VALUES ($1,$2,$3,$4,'TRADING212',$5,'101') RETURNING id",
     [users[0],strategies[0],accounts[0],buys[0],externalAccount]
   );
   expect(link).toHaveLength(1);
   await expect(sql!.unsafe(
     "INSERT INTO broker_trade_links (user_id,strategy_instance_id,account_id,ledger_event_id,provider,external_account_ref,external_trade_id) "+
     "VALUES ($1,$2,$3,$4,'TRADING212',$5,'102')",
     [users[0],strategies[1],accounts[1],buys[0],externalAccount]
   )).rejects.toThrow(/BROKER_TRADE_LINK_SCOPE_MISMATCH/);
   await expect(sql!.unsafe(
     "INSERT INTO broker_trade_links (user_id,strategy_instance_id,account_id,ledger_event_id,provider,external_account_ref,external_trade_id) "+
     "VALUES ($1,$2,$3,$4,'TRADING212',$5,'103')",
     [users[0],strategies[0],accounts[0],contribution,externalAccount]
   )).rejects.toThrow(/BROKER_TRADE_LINK_SCOPE_MISMATCH/);
 });
 it("blocks the same external trade ID from being claimed by a second strategy",async()=>{
   await expect(sql!.unsafe(
     "INSERT INTO broker_trade_links (user_id,strategy_instance_id,account_id,ledger_event_id,provider,external_account_ref,external_trade_id) "+
     "VALUES ($1,$2,$3,$4,'TRADING212',$5,'101')",
     [users[0],strategies[1],accounts[1],buys[1],externalAccount]
   )).rejects.toMatchObject({code:"23505"});
   // An independent transaction ID of the SAME ETF remains explicitly attributable.
   await sql!.unsafe(
     "INSERT INTO broker_trade_links (user_id,strategy_instance_id,account_id,ledger_event_id,provider,external_account_ref,external_trade_id) "+
     "VALUES ($1,$2,$3,$4,'TRADING212',$5,'104')",
     [users[0],strategies[1],accounts[1],buys[1],externalAccount]
   );
 });
 it("isolates customers and retains no unselected account holdings",async()=>{
   await sql!.unsafe(
     "INSERT INTO broker_trade_links (user_id,strategy_instance_id,account_id,ledger_event_id,provider,external_account_ref,external_trade_id) "+
     "VALUES ($1,$2,$3,$4,'TRADING212',$5,'101')",
     [users[1],strategies[2],accounts[2],buys[2],externalAccount]
   );
   const own=await sql!.unsafe("SELECT external_trade_id FROM broker_trade_links WHERE user_id=$1 ORDER BY external_trade_id",[users[0]]);
   expect(own.map(r=>String(r.external_trade_id))).toEqual(["101","104"]);
   expect(await sql!.unsafe("SELECT 1 FROM broker_trade_links WHERE external_trade_id='UNRELATED'")).toHaveLength(0);
 });
});