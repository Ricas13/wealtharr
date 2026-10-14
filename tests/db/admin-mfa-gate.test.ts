import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import postgres from "postgres";

const current=vi.hoisted(()=>({id:"",role:"ADMIN",mfa:false}));
vi.mock("@/auth",()=>({auth:async()=>current.id?{user:{id:current.id,role:current.role,sessionVersion:0,mfa:current.mfa,authTime:Date.now()}}:null}));

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:2,prepare:false}):null;

describe.skipIf(!url)("admin two-step requirement",()=>{
  const run=Math.random().toString(36).slice(2,10);
  let adminId="";
  beforeAll(async()=>{
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id",[`gate-${run}@example.test`]);
    adminId=String(rows[0].id);
    current.id=adminId;
  });
  afterAll(async()=>{
    delete process.env.ADMIN_MFA_REQUIRED;
    if(!sql)return;
    await sql.unsafe("DELETE FROM users WHERE id=$1",[adminId]);
    await sql.end();
  });

  it("lets an admin without two-step sign-in through while the requirement is off",async()=>{
    delete process.env.ADMIN_MFA_REQUIRED;
    const { requireAdmin }=await import("@/lib/session");
    await expect(requireAdmin()).resolves.toMatchObject({id:adminId});
  });

  it("keeps that admin out of admin tools once required, but not out of their own account",async()=>{
    process.env.ADMIN_MFA_REQUIRED="true";
    const { requireAdmin,requireUser }=await import("@/lib/session");
    const { authFailure }=await import("@/lib/api-auth");
    await expect(requireAdmin()).rejects.toThrow("MFA_REQUIRED");
    await expect(requireUser()).resolves.toMatchObject({id:adminId});
    const response=authFailure(new Error("MFA_REQUIRED"));
    expect(response?.status).toBe(403);
    expect((await response!.json()).error).toMatch(/two-step/i);
  });

  it("admits the admin after enrolling, but only on a session that passed the second factor",async()=>{
    process.env.ADMIN_MFA_REQUIRED="true";
    await sql!.unsafe("UPDATE users SET mfa_enabled_at=now() WHERE id=$1",[adminId]);
    // A session opened before enrolment (or by any route that skipped the code) cannot act as an admin.
    current.mfa=false;
    const { requireAdmin:requireAdminNoMfa }=await import("@/lib/session");
    await expect(requireAdminNoMfa()).rejects.toThrow("UNAUTHENTICATED");
    delete process.env.ADMIN_MFA_REQUIRED;
    await expect(requireAdminNoMfa()).rejects.toThrow("UNAUTHENTICATED");
    process.env.ADMIN_MFA_REQUIRED="true";
    current.mfa=true;
    const { requireAdmin }=await import("@/lib/session");
    await expect(requireAdmin()).resolves.toMatchObject({id:adminId});
  });

  it("requireAdminWithMfa demands enrolled two-step sign-in passed in this session, whatever the setting",async()=>{
    delete process.env.ADMIN_MFA_REQUIRED;
    const { requireAdmin,requireAdminWithMfa }=await import("@/lib/session");
    // Not enrolled: an ordinary admin gate lets them through while the setting is off, this one does not.
    await sql!.unsafe("UPDATE users SET mfa_enabled_at=NULL WHERE id=$1",[adminId]);
    current.mfa=false;
    await expect(requireAdmin()).resolves.toMatchObject({id:adminId});
    await expect(requireAdminWithMfa()).rejects.toThrow("MFA_REQUIRED");
    // Enrolled but the session never passed the second factor.
    await sql!.unsafe("UPDATE users SET mfa_enabled_at=now() WHERE id=$1",[adminId]);
    await expect(requireAdminWithMfa()).rejects.toThrow();
    // Enrolled and passed in this session.
    current.mfa=true;
    await expect(requireAdminWithMfa()).resolves.toMatchObject({id:adminId});
  });

  it("still refuses an ordinary user, whatever the setting",async()=>{
    process.env.ADMIN_MFA_REQUIRED="true";
    await sql!.unsafe("UPDATE users SET role='USER' WHERE id=$1",[adminId]);
    current.role="USER";
    const { requireAdmin }=await import("@/lib/session");
    await expect(requireAdmin()).rejects.toThrow("FORBIDDEN");
  });
});
