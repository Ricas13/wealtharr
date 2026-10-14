import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import postgres from "postgres";

const session=vi.hoisted(()=>({id:"",authTime:0,mfa:true}));
vi.mock("@/lib/session",()=>({
 requireAdminWithMfa:async()=>{
  if(!session.id)throw new Error("UNAUTHENTICATED");
  if(!session.mfa)throw new Error("MFA_REQUIRED");
  return {id:session.id,authTime:session.authTime,mfaEnabled:true,sessionMfa:true,role:"ADMIN"};
 }
}));
vi.mock("@/lib/security-notice",()=>({notifySecurityEvent:async()=>true}));

const url=process.env.DATABASE_URL;
const db=url?postgres(url,{max:2,prepare:false}):null;
const origin="http://127.0.0.1:3000";
const suffix=Math.random().toString(36).slice(2,11);
const targetEmail="second-admin-"+suffix+"@example.test";
let adminId="",targetId="";
let previousOrigin:string|undefined;

async function attempt(){
 const {POST}=await import("@/app/api/admin/security/promote-admin/route");
 const response=await POST(new Request(origin+"/api/admin/security/promote-admin",{
  method:"POST",headers:{origin,"content-type":"application/json"},
  body:JSON.stringify({email:targetEmail,confirmation:"PROMOTE TO ADMIN"})
 }));
 return {status:response.status,body:await response.json() as Record<string,unknown>};
}

describe.skipIf(!url)("second administrator promotion transaction",()=>{
 beforeAll(async()=>{
  previousOrigin=process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL=origin;
  const admin=await db!.unsafe(
   "INSERT INTO users (email,password_hash,role,mfa_enabled_at,email_verified_at) VALUES ($1,'x','ADMIN',now(),now()) RETURNING id",
   ["first-admin-"+suffix+"@example.test"]
  );
  const target=await db!.unsafe(
   "INSERT INTO users (email,password_hash,role) VALUES ($1,'x','USER') RETURNING id",
   [targetEmail]
  );
  adminId=String(admin[0].id);targetId=String(target[0].id);
  session.id=adminId;session.authTime=Date.now();
 });
 afterAll(async()=>{
  if(previousOrigin===undefined)delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL=previousOrigin;
  if(!db)return;
  await db.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[adminId]);
  await db.unsafe("DELETE FROM rate_limits WHERE key=$1",["admin-role-promotion:"+adminId]);
  await db.unsafe("DELETE FROM users WHERE id=$1 OR id=$2",[adminId,targetId]);
  await db.end();
 });

 it("refuses an unverified or non-MFA target without changing its role",async()=>{
  expect((await attempt()).status).toBe(409);
  await db!.unsafe("UPDATE users SET email_verified_at=now() WHERE id=$1",[targetId]);
  expect((await attempt()).status).toBe(409);
  const rows=await db!.unsafe("SELECT role,session_version FROM users WHERE id=$1",[targetId]);
  expect(String(rows[0].role)).toBe("USER");
  expect(Number(rows[0].session_version)).toBe(0);
 });

 it("requires the acting administrator to have signed in with MFA recently",async()=>{
  await db!.unsafe("UPDATE users SET mfa_enabled_at=now() WHERE id=$1",[targetId]);
  session.authTime=Date.now()-11*60_000;
  expect((await attempt()).status).toBe(403);
  session.authTime=Date.now();
 });

 it("atomically promotes exactly once, audits it and invalidates old sessions",async()=>{
  const success=await attempt();
  expect(success.status).toBe(200);
  expect(success.body).toMatchObject({ok:true,notificationSent:true});
  const rows=await db!.unsafe("SELECT role,session_version FROM users WHERE id=$1",[targetId]);
  expect(rows[0].role).toBe("ADMIN");
  expect(Number(rows[0].session_version)).toBe(1);
  const audits=await db!.unsafe(
   "SELECT action,metadata FROM audit_events WHERE actor_user_id=$1 AND entity_id=$2 AND action='admin.role.granted'",
   [adminId,targetId]
  );
  expect(audits).toHaveLength(1);
  expect(audits[0].metadata).toEqual({});
  expect((await attempt()).status).toBe(409);
  const repeat=await db!.unsafe(
   "SELECT count(*)::int AS c FROM audit_events WHERE actor_user_id=$1 AND action='admin.role.granted'",
   [adminId]
  );
  expect(Number(repeat[0].c)).toBe(1);
 });
});
