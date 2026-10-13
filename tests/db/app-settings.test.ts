import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import postgres from "postgres";

type SessionUser={id:string;email:string;country:string;baseCurrency:string;timezone:string;role:string;anonymousAggregateOptIn:boolean};
const session=vi.hoisted(()=>({user:null as SessionUser|null}));
vi.mock("@/lib/session",()=>({
  requireUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;},
  requireAdmin:async()=>{
    if(!session.user)throw new Error("UNAUTHENTICATED");
    if(session.user.role!=="ADMIN")throw new Error("FORBIDDEN");
    return session.user;
  },
  requirePageUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;}
}));

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:3,prepare:false}):null;
const ORIGIN="http://127.0.0.1:3000";
const KEYS=["EMAIL_FROM","STRIPE_SECRET_KEY","CRON_CONCURRENCY","NEXT_PUBLIC_BRAND_NAME","ADMIN_MFA_REQUIRED","NEXT_PUBLIC_APP_URL","TURNSTILE_ENABLED","TURNSTILE_SITE_KEY","TURNSTILE_SECRET_KEY"];

describe.skipIf(!url)("admin settings",()=>{
  const run=Math.random().toString(36).slice(2,10);
  let adminId="";
  const saved:Record<string,string|undefined>={};

  async function put(changes:Array<{key:string;value:string|null}>,origin=ORIGIN){
    const {PUT}=await import("@/app/api/admin/settings/route");
    const response=await PUT(new Request(ORIGIN+"/api/admin/settings",{method:"PUT",headers:{origin,"content-type":"application/json"},body:JSON.stringify({changes})}));
    return {status:response.status,json:await response.json() as {error?:string;errors?:Record<string,string>;settings?:Array<{key:string;source:string;value:string|null}>}};
  }
  async function get(){
    const {GET}=await import("@/app/api/admin/settings/route");
    const response=await GET();
    return {status:response.status,text:await response.text()};
  }

  beforeAll(async()=>{
    for(const k of KEYS)saved[k]=process.env[k];
    process.env.NEXT_PUBLIC_APP_URL=ORIGIN;
    // The "environment file" value, in place before the settings layer first runs.
    process.env.NEXT_PUBLIC_BRAND_NAME="FromEnvFile";
    process.env.APP_ENCRYPTION_KEY??="MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
    await sql!.unsafe("DELETE FROM app_settings");
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id",[`settings-${run}@example.test`]);
    adminId=String(rows[0].id);
    session.user={id:adminId,email:`settings-${run}@example.test`,country:"GB",baseCurrency:"GBP",timezone:"Europe/London",role:"ADMIN",anonymousAggregateOptIn:false};
  });
  afterAll(async()=>{
    for(const k of KEYS){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
    if(!sql)return;
    await sql.unsafe("DELETE FROM app_settings");
    await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[adminId]);
    await sql.unsafe("DELETE FROM rate_limits WHERE key LIKE $1",["%"+adminId+"%"]);
    await sql.unsafe("DELETE FROM users WHERE id=$1",[adminId]);
    await sql.end();
  });

  it("refuses anonymous callers and ordinary users",async()=>{
    session.user=null;
    expect((await get()).status).toBe(401);
    session.user={id:adminId,email:"u@example.test",country:"GB",baseCurrency:"GBP",timezone:"Europe/London",role:"USER",anonymousAggregateOptIn:false};
    expect((await get()).status).toBe(403);
    expect((await put([{key:"EMAIL_FROM",value:"a@b.test"}])).status).toBe(403);
    session.user={...session.user,role:"ADMIN"};
  });

  it("saves a setting, applies it to the running process and reports where it came from",async()=>{
    delete process.env.EMAIL_FROM;
    const result=await put([{key:"EMAIL_FROM",value:"support@example.test"},{key:"CRON_CONCURRENCY",value:"6"}]);
    expect(result.status).toBe(200);
    expect(process.env.EMAIL_FROM).toBe("support@example.test");
    expect(process.env.CRON_CONCURRENCY).toBe("6");
    const email=result.json.settings!.find((s)=>s.key==="EMAIL_FROM")!;
    expect(email).toMatchObject({source:"database",value:"support@example.test"});
  });

  it("stores values encrypted and never returns a secret",async()=>{
    const secret="sk_test_"+run+"_SUPERSECRETVALUE";
    const result=await put([{key:"STRIPE_SECRET_KEY",value:secret}]);
    expect(result.status).toBe(200);
    expect(process.env.STRIPE_SECRET_KEY).toBe(secret);
    const stored=await sql!.unsafe("SELECT value_encrypted FROM app_settings WHERE key='STRIPE_SECRET_KEY'");
    expect(String(stored[0].value_encrypted)).not.toContain("SUPERSECRET");
    expect(JSON.stringify(result.json)).not.toContain("SUPERSECRET");
    const listed=await get();
    expect(listed.text).not.toContain("SUPERSECRET");
    const view=JSON.parse(listed.text).settings.find((s:{key:string})=>s.key==="STRIPE_SECRET_KEY");
    expect(view).toMatchObject({source:"database",value:null});
  });

  it("falls back to the environment value when a saved setting is cleared",async()=>{
    await put([{key:"NEXT_PUBLIC_BRAND_NAME",value:"SavedHere"}]);
    expect(process.env.NEXT_PUBLIC_BRAND_NAME).toBe("SavedHere");
    const cleared=await put([{key:"NEXT_PUBLIC_BRAND_NAME",value:null}]);
    expect(cleared.status).toBe(200);
    expect(process.env.NEXT_PUBLIC_BRAND_NAME).toBe("FromEnvFile");
    expect(cleared.json.settings!.find((s)=>s.key==="NEXT_PUBLIC_BRAND_NAME")).toMatchObject({source:"environment",value:"FromEnvFile"});
  });

  it("validates everything first and saves nothing when any value is bad",async()=>{
    const before=(await sql!.unsafe("SELECT count(*)::int AS n FROM app_settings"))[0].n;
    const result=await put([{key:"EMAIL_FROM",value:"changed@example.test"},{key:"CRON_CONCURRENCY",value:"500"},{key:"NOT_A_SETTING",value:"x"}]);
    expect(result.status).toBe(400);
    expect(Object.keys(result.json.errors!).sort()).toEqual(["CRON_CONCURRENCY","NOT_A_SETTING"]);
    expect((await sql!.unsafe("SELECT count(*)::int AS n FROM app_settings"))[0].n).toBe(before);
    expect(process.env.EMAIL_FROM).toBe("support@example.test");
  });

  it("will not accept a public address other than the one the admin is using",async()=>{
    const result=await put([{key:"NEXT_PUBLIC_APP_URL",value:"https://elsewhere.example.com"}]);
    expect(result.status).toBe(400);
    expect(result.json.errors!.NEXT_PUBLIC_APP_URL).toMatch(/address you are using/);
    expect(process.env.NEXT_PUBLIC_APP_URL).toBe(ORIGIN);
  });

  it("will not require admin two-step sign-in from an admin who has not enrolled",async()=>{
    const result=await put([{key:"ADMIN_MFA_REQUIRED",value:"true"}]);
    expect(result.status).toBe(400);
    expect(result.json.errors!.ADMIN_MFA_REQUIRED).toMatch(/two-step/i);
    await sql!.unsafe("UPDATE users SET mfa_enabled_at=now() WHERE id=$1",[adminId]);
    expect((await put([{key:"ADMIN_MFA_REQUIRED",value:"true"}])).status).toBe(200);
    expect(process.env.ADMIN_MFA_REQUIRED).toBe("true");
    await put([{key:"ADMIN_MFA_REQUIRED",value:null}]);
  });

  it("audits what changed without recording any value",async()=>{
    const rows=await sql!.unsafe("SELECT metadata FROM audit_events WHERE actor_user_id=$1 AND action='settings.changed'",[adminId]);
    expect(rows.length).toBeGreaterThan(3);
    const text=JSON.stringify(rows.map((r)=>r.metadata));
    expect(text).toContain("STRIPE_SECRET_KEY");
    expect(text).not.toContain("SUPERSECRET");
    expect(text).not.toContain("support@example.test");
  });

  it("ignores a stored value it can no longer decrypt instead of failing",async()=>{
    await sql!.unsafe("INSERT INTO app_settings (key,value_encrypted) VALUES ('CRON_MAX_INSTANCES','not-valid-ciphertext') ON CONFLICT (key) DO UPDATE SET value_encrypted=EXCLUDED.value_encrypted");
    const {ensureSettings}=await import("@/lib/settings");
    delete process.env.CRON_MAX_INSTANCES;
    await expect(ensureSettings(true)).resolves.toBeUndefined();
    expect(process.env.CRON_MAX_INSTANCES).toBeUndefined();
    expect(process.env.EMAIL_FROM).toBe("support@example.test");
  });
  it("configures Turnstile wholly in Admin with encrypted keys and prevents half-updated credentials",async()=>{
    const site="0x4AAAAAAAAdminTestSiteKey",secret="0x4AAAAAAAAdminPrivateSecret";
    const missing=await put([{key:"TURNSTILE_ENABLED",value:"true"}]);
    expect(missing.status).toBe(400);
    expect(missing.json.errors?.TURNSTILE_ENABLED).toContain("site key");
    const partial=await put([{key:"TURNSTILE_SITE_KEY",value:site}]);
    expect(partial.status).toBe(400);
    expect(partial.json.errors?.TURNSTILE_SITE_KEY).toContain("together");
    const saved=await put([{key:"TURNSTILE_SITE_KEY",value:site},{key:"TURNSTILE_SECRET_KEY",value:secret}]);
    expect(saved.status).toBe(200);
    expect(saved.json.settings?.find(s=>s.key==="TURNSTILE_SITE_KEY")).toMatchObject({source:"database",value:site});
    expect(saved.json.settings?.find(s=>s.key==="TURNSTILE_SECRET_KEY")).toMatchObject({source:"database",value:null});
    const stored=await sql!.unsafe("SELECT value_encrypted FROM app_settings WHERE key='TURNSTILE_SECRET_KEY'");
    expect(String(stored[0].value_encrypted)).not.toContain(secret);
    expect((await get()).text).not.toContain(secret);
    expect((await put([{key:"TURNSTILE_ENABLED",value:"true"}])).status).toBe(200);
    const rotate=await put([{key:"TURNSTILE_SITE_KEY",value:site+"New"},{key:"TURNSTILE_SECRET_KEY",value:secret+"New"}]);
    expect(rotate.status).toBe(400);
    expect(rotate.json.errors?.TURNSTILE_ENABLED).toContain("Turn off");
    expect((await put([{key:"TURNSTILE_ENABLED",value:"false"}])).status).toBe(200);
    expect((await put([{key:"TURNSTILE_SITE_KEY",value:site+"New"},{key:"TURNSTILE_SECRET_KEY",value:secret+"New"}])).status).toBe(200);
  });

});
