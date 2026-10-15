import {beforeAll,afterAll,describe,it,expect} from "vitest";
import postgres from "postgres";
import {insertSafeTacticalRelease} from "@/lib/tactical-release-upgrade";
const url=process.env.DATABASE_URL;
const db=url?postgres(url,{max:2,prepare:false}):null;
describe.skipIf(!url)("group4 legacy research-to-published version upgrade",()=>{
 const suffix=Math.random().toString(36).slice(2,10);
 let id="",blockedId="";
 const config={variant:"GEM_CLASSIC",riskAssets:["US","EXUS"],defensiveAssets:["BILLS","AGG"],
  reviewFrequency:"MONTHLY",reviewSchedule:"CALENDAR_MONTH_COMPLETE",rebalanceThreshold:"0"};
 const args=(definitionId:string)=>({definitionId,name:"GEM method",family:"TACTICAL",
  description:"Canonical Global Equities Momentum release",config,inputSchema:[],
  disclosure:"Rules-based, historical-data-dependent model"});
 beforeAll(async()=>{
  const d=await db!.unsafe("INSERT INTO strategy_definitions (key,name,family,engine,enabled) "+
   "VALUES ($1,'Legacy research','MOMENTUM','MOMENTUM_ROTATION',false) RETURNING id",
   ["tactical-upgrade-"+suffix]);id=String(d[0].id);
  await db!.unsafe("INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,input_schema,config) "+
   "VALUES ($1,'1.0','2025-01-01','MOMENTUM_ROTATION','DRAFT','[]'::jsonb,'{}'::jsonb)",[id]);
  const x=await db!.unsafe("INSERT INTO strategy_definitions (key,name,family,engine,enabled) "+
   "VALUES ($1,'Blocked operator release','MOMENTUM','MOMENTUM_ROTATION',true) RETURNING id",
   ["tactical-upgrade-blocked-"+suffix]);blockedId=String(x[0].id);
 });
 afterAll(async()=>{
  if(!db)return;
  await db.unsafe("SET app.allow_published_edit='on'");
  await db.unsafe("DELETE FROM strategy_versions WHERE strategy_definition_id IN ($1,$2)",[id,blockedId]);
  await db.unsafe("DELETE FROM strategy_definitions WHERE id IN ($1,$2)",[id,blockedId]);
  await db.end();
 });
 it("adds published canonical 2.0 without editing prior research draft",async()=>{
  const result=await db!.begin(tx=>insertSafeTacticalRelease(tx,args(id)));
  expect(result).toBe("CREATED");
  const rows=await db!.unsafe("SELECT version,engine_key,lifecycle_status,config FROM strategy_versions "+
   "WHERE strategy_definition_id=$1 ORDER BY version",[id]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({version:"1.0",engine_key:"MOMENTUM_ROTATION",lifecycle_status:"DRAFT"});
  expect(rows[0].config).toEqual({});
  expect(rows[1]).toMatchObject({version:"2.0",engine_key:"TACTICAL_ALLOCATION",lifecycle_status:"PUBLISHED"});
  expect(rows[1].config).toMatchObject(config);
  expect((await db!.unsafe("SELECT engine,enabled FROM strategy_definitions WHERE id=$1",[id]))[0])
   .toMatchObject({engine:"TACTICAL_ALLOCATION",enabled:false});
  await expect(db!.unsafe("UPDATE strategy_versions SET config='{}'::jsonb "+
   "WHERE strategy_definition_id=$1 AND version='2.0'",[id])).rejects.toThrow(/IMMUTABLE/);
 });
 it("is idempotent and cannot overwrite signed-off published rule versions",async()=>{
  expect(await db!.begin(tx=>insertSafeTacticalRelease(tx,args(id)))).toBe("UNCHANGED");
  expect(Number((await db!.unsafe("SELECT count(*)::int AS n FROM strategy_versions WHERE strategy_definition_id=$1",[id]))[0].n)).toBe(2);
 });
 it("never repoints an operator-enabled existing definition",async()=>{
  expect(await db!.begin(tx=>insertSafeTacticalRelease(tx,args(blockedId)))).toBe("BLOCKED");
  expect((await db!.unsafe("SELECT engine,enabled FROM strategy_definitions WHERE id=$1",[blockedId]))[0])
   .toMatchObject({engine:"MOMENTUM_ROTATION",enabled:true});
  expect(Number((await db!.unsafe("SELECT count(*)::int AS n FROM strategy_versions WHERE strategy_definition_id=$1",[blockedId]))[0].n)).toBe(0);
 });
});
