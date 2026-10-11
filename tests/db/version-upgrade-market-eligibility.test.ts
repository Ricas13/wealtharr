import {afterAll,beforeAll,describe,expect,it} from "vitest";
import postgres from "postgres";
import {migrateStrategyVersion} from "@/lib/strategy-service";

const connection=process.env.DATABASE_URL;
const db=connection?postgres(connection,{max:2,prepare:false}):null;
const suffix=Math.random().toString(36).slice(2,10);
const base={targetExposure:"NASDAQ_100_3X_LONG",reviewFrequency:"QUARTERLY",targetRate:"0.09",
 initialTargetRatio:"0.60",contributionTargetRatio:"0.50",tolerance:"0.01"};
const proposed={...base,targetExposure:"UNVERIFIED_UPGRADE_"+suffix.toUpperCase()};

describe.skipIf(!connection)("published strategy upgrade must retain the old version when target market is missing",()=>{
 let userId="",definitionId="",accountId="",instanceId="",oldVersion="",newVersion="";
 beforeAll(async()=>{
   const user=await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",
     ["upgrade-market-"+suffix+"@example.test"]);userId=String(user[0].id);
   const def=await db!.unsafe(
     "INSERT INTO strategy_definitions (key,name,family,engine,enabled) "+
     "VALUES ($1,'Upgrade market test','SIGNAL_VALUE_TARGET','VALUE_TARGET',true) RETURNING id",
     ["upgrade-market-"+suffix]);
   definitionId=String(def[0].id);
   const first=await db!.unsafe(
     "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config) "+
     "VALUES ($1,'1.0','2026-01-01','VALUE_TARGET','PUBLISHED','[]'::jsonb,$2::text::jsonb) RETURNING id",
     [definitionId,JSON.stringify(base)]);
   oldVersion=String(first[0].id);
   const next=await db!.unsafe(
     "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config) "+
     "VALUES ($1,'2.0','2026-01-02','VALUE_TARGET','PUBLISHED','[]'::jsonb,$2::text::jsonb) RETURNING id",
     [definitionId,JSON.stringify(proposed)]);
   newVersion=String(next[0].id);
   const account=await db!.unsafe(
     "INSERT INTO accounts (user_id,name,wrapper,country,currency) "+
     "VALUES ($1,'ISA','ISA','GB','GBP') RETURNING id",[userId]);
   accountId=String(account[0].id);
   const instance=await db!.unsafe(
     "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) "+
     "VALUES ($1,$2,$3,$4,'Version upgrade') RETURNING id",
     [userId,accountId,definitionId,oldVersion]);
   instanceId=String(instance[0].id);
   await db!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",
     [instanceId,accountId]);
   await db!.unsafe(
     "INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) "+
     "VALUES ($1,$2,$3::text::jsonb)",
     [instanceId,oldVersion,JSON.stringify({targetValue:"6000",reviewTargetValue:"6540",reviewContributionsSnapshot:"1000"})]);
 });
 afterAll(async()=>{
   if(!db)return;
   if(userId)await db.unsafe("DELETE FROM users WHERE id=$1",[userId]);
   if(definitionId)await db.unsafe("DELETE FROM strategy_versions WHERE strategy_definition_id=$1",[definitionId]);
   if(definitionId)await db.unsafe("DELETE FROM strategy_definitions WHERE id=$1",[definitionId]);
   await db.end();
 });
 it("fails closed without touching the current version, state, or migration log",async()=>{
   await expect(migrateStrategyVersion(userId,instanceId,newVersion))
     .rejects.toMatchObject({code:"STRATEGY_MARKET_UNAVAILABLE"});
   const rows=await db!.unsafe(
     "SELECT i.strategy_version_id,s.strategy_version_id AS state_version,s.state "+
     "FROM strategy_instances i JOIN strategy_states s ON s.strategy_instance_id=i.id WHERE i.id=$1",[instanceId]);
   expect(String(rows[0].strategy_version_id)).toBe(oldVersion);
   expect(String(rows[0].state_version)).toBe(oldVersion);
   expect(rows[0].state).toMatchObject({targetValue:"6000",reviewTargetValue:"6540",reviewContributionsSnapshot:"1000"});
   const migrations=await db!.unsafe("SELECT id FROM strategy_version_migrations WHERE strategy_instance_id=$1",[instanceId]);
   expect(migrations).toHaveLength(0);
 });
});
