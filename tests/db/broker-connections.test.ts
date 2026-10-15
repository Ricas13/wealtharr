import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
const url=process.env.DATABASE_URL;
const db=url?postgres(url,{max:1,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,12);
const owned:string[]=[];
const strategies:string[]=[];
const accounts:string[]=[];
describe.skipIf(!url)("read-only broker connection ownership and retention",()=>{
 beforeAll(async()=>{
  for(let i=0;i<2;i++){
   const u=await db!.unsafe("INSERT INTO users(email,password_hash) VALUES ($1,'x') RETURNING id",["broker-connection-"+suffix+i+"@example.test"]);
   const userId=String(u[0].id);owned.push(userId);
   const a=await db!.unsafe("INSERT INTO accounts(user_id,name,wrapper,country,currency) VALUES ($1,'Test','ISA','GB','GBP') RETURNING id",[userId]);
   accounts.push(String(a[0].id));
   const s=await db!.unsafe(
    "INSERT INTO strategy_instances(user_id,account_id,strategy_definition_id,strategy_version_id,name) "+
    "SELECT $1,$2,d.id,v.id,'Test' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id "+
    "WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id",[userId,accounts[i]]);
   if(!s[0])throw new Error("SYNTHETIC_CI_STRATEGY_FIXTURE_MISSING");
   strategies.push(String(s[0].id));
  }
 });
 afterAll(async()=>{
  if(!db)return;
  for(const u of owned)await db.unsafe("DELETE FROM users WHERE id=$1",[u]);
  await db.end();
 });
 it("rejects a connection whose strategy belongs to a different user, even through direct SQL",async()=>{
  await expect(db!.unsafe(
   "INSERT INTO strategy_broker_connections(user_id,strategy_instance_id,environment,external_account_ref,account_currency,api_key_encrypted,api_secret_encrypted,consented_read_only_at) "+
   "VALUES ($1,$2,'demo','42','GBP','fake','fake',now())",[owned[0],strategies[1]]
  )).rejects.toThrow(/BROKER_CONNECTION_OWNER_MISMATCH/);
 });
 it("stores only a single encrypted-key record per strategy, without position rows",async()=>{
  const result=await db!.unsafe(
   "INSERT INTO strategy_broker_connections(user_id,strategy_instance_id,environment,external_account_ref,account_currency,api_key_encrypted,api_secret_encrypted,consented_read_only_at) "+
   "VALUES ($1,$2,'demo','42','GBP','cipher-1','cipher-2',now()) RETURNING id",
   [owned[0],strategies[0]]);
  expect(result).toHaveLength(1);
  await expect(db!.unsafe(
   "INSERT INTO strategy_broker_connections(user_id,strategy_instance_id,environment,external_account_ref,account_currency,api_key_encrypted,api_secret_encrypted,consented_read_only_at) "+
   "VALUES ($1,$2,'demo','43','GBP','fake','fake',now())",[owned[0],strategies[0]]
  )).rejects.toMatchObject({code:"23505"});
  const rows=await db!.unsafe(
   "SELECT external_account_ref,last_sync_status,last_sync_summary FROM strategy_broker_connections WHERE strategy_instance_id=$1",[strategies[0]]);
  expect(rows[0].external_account_ref).toBe("42");
  expect(rows[0].last_sync_status).toBe("NOT_SYNCED");
  expect(rows[0].last_sync_summary).toEqual({});
 });
 it("disconnect removes credentials but never rewrites the strategy or its ledger",async()=>{
  await db!.unsafe("DELETE FROM strategy_broker_connections WHERE user_id=$1 AND strategy_instance_id=$2",[owned[0],strategies[0]]);
  expect(await db!.unsafe("SELECT 1 FROM strategy_broker_connections WHERE strategy_instance_id=$1",[strategies[0]])).toHaveLength(0);
  expect(await db!.unsafe("SELECT 1 FROM strategy_instances WHERE id=$1",[strategies[0]])).toHaveLength(1);
 });
});
