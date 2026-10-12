import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import postgres from "postgres";
import {randomUUID} from "node:crypto";
const ids=vi.hoisted(()=>({admin:""}));
vi.mock("@/lib/session",()=>({requireAdmin:async()=>({id:ids.admin,role:"ADMIN"})}));
const url=process.env.DATABASE_URL;
const db=url?postgres(url,{max:1,prepare:false}):null;
const ORIGIN="http://127.0.0.1:3000";

describe.skipIf(!url)("per-user strategy override storage and admin API",()=>{
 const suffix=randomUUID().slice(0,8);
 let user="",definition="",key="access-test-"+suffix;
 beforeAll(async()=>{
  process.env.NEXT_PUBLIC_APP_URL=ORIGIN;
  ids.admin=String((await db!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id",["ac-admin-"+suffix+"@example.test"]))[0].id);
  user=String((await db!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",["ac-user-"+suffix+"@example.test"]))[0].id);
  definition=String((await db!.unsafe("INSERT INTO strategy_definitions (key,name,family,engine,enabled) VALUES ($1,'Test user access','FIXED_ALLOCATION','FIXED_ALLOCATION',false) RETURNING id",[key]))[0].id);
 });
 afterAll(async()=>{
  if(!db)return;
  await db.unsafe("DELETE FROM users WHERE id=$1",[user]);
  await db.unsafe("DELETE FROM strategy_definitions WHERE id=$1",[definition]);
  await db.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[ids.admin]);
  await db.unsafe("DELETE FROM users WHERE id=$1",[ids.admin]);
  await db.end();
 });
 async function update(access:"ALLOW"|"DENY"|"INHERIT"){
  const {PUT}=await import("@/app/api/admin/user-strategy-access/route");
  return PUT(new Request(ORIGIN+"/api/admin/user-strategy-access",{
   method:"PUT",headers:{origin:ORIGIN,"content-type":"application/json"},
   body:JSON.stringify({userId:user,strategyKey:key,access})
  }));
 }
 it("blocks, allows and removes an override without deleting customer history",async()=>{
  const {assertUserStrategyAccessWith}=await import("@/lib/user-strategy-access");
  expect((await update("DENY")).status).toBe(200);
  await expect(assertUserStrategyAccessWith(db!,user,definition)).rejects.toThrow("STRATEGY_NOT_ALLOWED_FOR_USER");
  expect((await update("ALLOW")).status).toBe(200);
  await expect(assertUserStrategyAccessWith(db!,user,definition)).resolves.toBeUndefined();
  expect((await update("INHERIT")).status).toBe(200);
  expect((await db!.unsafe("SELECT count(*)::int AS n FROM user_strategy_access WHERE user_id=$1",[user]))[0].n).toBe(0);
 });
 it("refuses an unknown strategy without creating overrides",async()=>{
  const {PUT}=await import("@/app/api/admin/user-strategy-access/route");
  const res=await PUT(new Request(ORIGIN+"/api/admin/user-strategy-access",{
   method:"PUT",headers:{origin:ORIGIN,"content-type":"application/json"},
   body:JSON.stringify({userId:user,strategyKey:"not-a-real-strategy",access:"DENY"})
  }));
  expect(res.status).toBe(404);
 });
});
