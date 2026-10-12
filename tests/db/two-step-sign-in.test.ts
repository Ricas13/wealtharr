import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { decryptSecret } from "@/lib/crypto";
import { totpAt,currentStep } from "@/domain/totp";

type SessionUser={id:string;email:string;country:string;baseCurrency:string;timezone:string;role:string;anonymousAggregateOptIn:boolean};
const session=vi.hoisted(()=>({user:null as SessionUser|null}));
vi.mock("@/lib/session",()=>({
  requireUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;},
  requireAdmin:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;},
  requirePageUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;}
}));

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:3,prepare:false}):null;
const ORIGIN="http://127.0.0.1:3000";

describe.skipIf(!url)("two-step sign-in",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const password="correct horse battery staple";
  let userId="";

  async function post(path:"setup"|"enable"|"disable",body?:unknown){
    const mods={
      setup:()=>import("@/app/api/account/mfa/setup/route"),
      enable:()=>import("@/app/api/account/mfa/enable/route"),
      disable:()=>import("@/app/api/account/mfa/disable/route")
    } as const;
    const mod=await mods[path]();
    const response=await mod.POST(new Request(ORIGIN+"/api/account/mfa/"+path,{method:"POST",headers:{origin:ORIGIN,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)}));
    return {status:response.status,json:await response.json() as Record<string,any>};
  }
  const storedSecret=async()=>decryptSecret(String((await sql!.unsafe("SELECT mfa_secret_encrypted FROM users WHERE id=$1",[userId]))[0].mfa_secret_encrypted));

  beforeAll(async()=>{
    process.env.NEXT_PUBLIC_APP_URL=ORIGIN;
    process.env.EMAIL_PROVIDER="mock";
    process.env.APP_ENCRYPTION_KEY??="MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
    const hash=await bcrypt.hash(password,4);
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,$2) RETURNING id",[`mfa-${run}@example.test`,hash]);
    userId=String(rows[0].id);
    session.user={id:userId,email:`mfa-${run}@example.test`,country:"GB",baseCurrency:"GBP",timezone:"Europe/London",role:"USER",anonymousAggregateOptIn:false};
  });
  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM rate_limits WHERE key LIKE $1",["%"+userId+"%"]);
    await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[userId]);
    await sql.unsafe("DELETE FROM users WHERE id=$1",[userId]);
    await sql.end();
  });

  let recoveryCodes:string[]=[];

  it("a half-finished setup does not turn protection on",async()=>{
    const { verifySecondFactor }=await import("@/lib/mfa");
    expect((await post("setup")).status).toBe(400);
    expect((await post("setup",{password:"wrong password!!"})).status).toBe(400);
    expect((await sql!.unsafe("SELECT mfa_secret_encrypted FROM users WHERE id=$1",[userId]))[0].mfa_secret_encrypted).toBeNull();
    const setup=await post("setup",{password});
    expect(setup.status).toBe(200);
    expect(setup.json.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.json.otpauthUri).toContain("otpauth://totp/");
    const row=(await sql!.unsafe("SELECT mfa_enabled_at FROM users WHERE id=$1",[userId]))[0];
    expect(row.mfa_enabled_at).toBeNull();
    // Not enabled, so nothing can pass as a second factor and sign-in would not ask for one.
    expect(await verifySecondFactor(userId,totpAt(setup.json.secret,currentStep(new Date())))).toBe(false);
  });

  it("refuses a wrong confirmation code, then enables with the right one and returns recovery codes",async()=>{
    expect((await post("enable",{code:"000000",password})).status).toBe(400);
    const secret=await storedSecret();
    const validCode=totpAt(secret,currentStep(new Date()));
    // A valid code alone is not enough: the password is checked too, and the code is not spent.
    expect((await post("enable",{code:validCode})).status).toBe(400);
    expect((await post("enable",{code:validCode,password:"wrong password!!"})).status).toBe(400);
    expect((await sql!.unsafe("SELECT mfa_enabled_at FROM users WHERE id=$1",[userId]))[0].mfa_enabled_at).toBeNull();
    const versionBefore=Number((await sql!.unsafe("SELECT session_version FROM users WHERE id=$1",[userId]))[0].session_version);
    const enabled=await post("enable",{code:validCode,password});
    // Turning it on ends every existing session so none predates the second factor.
    expect(Number((await sql!.unsafe("SELECT session_version FROM users WHERE id=$1",[userId]))[0].session_version)).toBe(versionBefore+1);
    expect(enabled.status).toBe(200);
    recoveryCodes=enabled.json.recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    const stored=await sql!.unsafe("SELECT mfa_enabled_at,mfa_recovery_hashes FROM users WHERE id=$1",[userId]);
    expect(stored[0].mfa_enabled_at).not.toBeNull();
    // Only hashes are stored.
    expect(JSON.stringify(stored[0].mfa_recovery_hashes)).not.toContain(recoveryCodes[0]);
    expect((await post("setup",{password})).status).toBe(409);
  });

  it("accepts a fresh code once and refuses its replay",async()=>{
    const { verifySecondFactor }=await import("@/lib/mfa");
    const secret=await storedSecret();
    // The enrolment code consumed the current step; the next step's code is the next valid one.
    const next=new Date(Date.now()+30_000);
    const code=totpAt(secret,currentStep(next));
    expect(await verifySecondFactor(userId,code,next)).toBe(true);
    expect(await verifySecondFactor(userId,code,next)).toBe(false);
    expect(await verifySecondFactor(userId,"",next)).toBe(false);
    expect(await verifySecondFactor(userId,undefined,next)).toBe(false);
  });

  it("lets a recovery code in exactly once",async()=>{
    const { verifySecondFactor }=await import("@/lib/mfa");
    expect(await verifySecondFactor(userId,recoveryCodes[0])).toBe(true);
    expect(await verifySecondFactor(userId,recoveryCodes[0])).toBe(false);
    expect(await verifySecondFactor(userId,recoveryCodes[1].toLowerCase().replace("-",""))).toBe(true);
    const left=(await sql!.unsafe("SELECT cardinality(mfa_recovery_hashes) AS n FROM users WHERE id=$1",[userId]))[0];
    expect(left.n).toBe(8);
  });

  it("will not turn protection off without both the password and a valid code",async()=>{
    expect((await post("disable",{password:"wrong password!!",code:recoveryCodes[2]})).status).toBe(400);
    expect((await post("disable",{password,code:"123456"})).status).toBe(400);
    expect((await sql!.unsafe("SELECT mfa_enabled_at FROM users WHERE id=$1",[userId]))[0].mfa_enabled_at).not.toBeNull();
    // The failed attempts did not spend the recovery code.
    expect((await post("disable",{password,code:recoveryCodes[2]})).status).toBe(200);
    const row=(await sql!.unsafe("SELECT mfa_enabled_at,mfa_secret_encrypted,cardinality(mfa_recovery_hashes) AS n FROM users WHERE id=$1",[userId]))[0];
    expect(row.mfa_enabled_at).toBeNull();
    expect(row.mfa_secret_encrypted).toBeNull();
    expect(row.n).toBe(0);
    // Turning it off also ends every existing session.
    expect(Number((await sql!.unsafe("SELECT session_version FROM users WHERE id=$1",[userId]))[0].session_version)).toBe(2);
  });

  it("records enabling, recovery use and disabling in the audit log",async()=>{
    const actions=(await sql!.unsafe("SELECT action FROM audit_events WHERE actor_user_id=$1",[userId])).map((r)=>String(r.action));
    expect(actions).toEqual(expect.arrayContaining(["auth.mfa-enabled","auth.recovery-code-used","auth.mfa-disabled","security.notice"]));
    const notices=(await sql!.unsafe("SELECT metadata FROM audit_events WHERE actor_user_id=$1 AND action='security.notice'",[userId])).map((r)=>r.metadata as {kind:string;sent:boolean});
    expect(notices.map((n)=>n.kind).sort()).toEqual(["MFA_DISABLED","MFA_ENABLED"]);
    expect(notices.every((n)=>n.sent)).toBe(true);
  });
});
