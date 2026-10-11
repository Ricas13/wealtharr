import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { execFileSync } from "node:child_process";

// Setup only works while no administrator exists, so this runs against its own throwaway database
// (migrated from scratch) instead of the shared test database other tests create admins in.
const url=process.env.DATABASE_URL;
const admin=url?postgres(url,{max:1,prepare:false}):null;
type Setup=typeof import("@/lib/setup");

describe.skipIf(!url)("first-run setup",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const dbName="setup_test_"+run;
  const created:string[]=[];
  let sql:ReturnType<typeof postgres>;
  let lib:Setup;
  const originalUrl=url;

  beforeAll(async()=>{
    await admin!.unsafe(`CREATE DATABASE ${dbName}`);
    const scoped=new URL(originalUrl!);
    scoped.pathname="/"+dbName;
    execFileSync(process.execPath,["--import","tsx","scripts/migrate.ts"],{env:{...process.env,DATABASE_URL:scoped.toString()},stdio:"ignore"});
    process.env.DATABASE_URL=scoped.toString();
    vi.resetModules();
    lib=await import("@/lib/setup");
    sql=postgres(scoped.toString(),{max:2,prepare:false});
  },120_000);
  afterAll(async()=>{
    process.env.DATABASE_URL=originalUrl;
    if(sql)await sql.end();
    vi.resetModules();
    try{(await import("@/lib/db")).sql.end({timeout:1});}catch{/* none */}
    if(admin){
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  it("prints a one-time code, storing only its hash, when no administrator exists",async()=>{
    expect(await lib.adminExists()).toBe(false);
    const lines:string[]=[];
    const code=await lib.announceSetupIfNeeded((l)=>lines.push(l));
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(lines.join("\n")).toContain(code!);
    const rows=await sql.unsafe("SELECT code_hash FROM setup_codes");
    expect(rows).toHaveLength(1);
    expect(String(rows[0].code_hash)).not.toContain(code!.replace(/-/g,""));
    // A restart replaces the code rather than accumulating them.
    const second=await lib.announceSetupIfNeeded(()=>undefined);
    expect(second).not.toBe(code);
    expect((await sql.unsafe("SELECT count(*)::int AS n FROM setup_codes"))[0].n).toBe(1);
    (globalThis as {__code?:string}).__code=second!;
  });

  it("rejects a wrong code and creates nothing",async()=>{
    const result=await lib.completeSetup({code:lib.newSetupCode(),email:`first-${run}@example.test`,password:"a-long-enough-password"});
    expect(result).toEqual({ok:false,reason:"BAD_CODE"});
    expect((await sql.unsafe("SELECT 1 FROM users WHERE email=$1",[`first-${run}@example.test`]))).toHaveLength(0);
  });

  it("creates a verified administrator with the right code, then closes for good",async()=>{
    const code=(globalThis as {__code?:string}).__code!;
    const result=await lib.completeSetup({code:code.toLowerCase(),email:`first-${run}@example.test`,password:"a-long-enough-password"});
    expect(result.ok).toBe(true);
    if(!result.ok)return;
    created.push(result.userId);
    const row=(await sql.unsafe("SELECT role,email_verified_at,password_hash FROM users WHERE id=$1",[result.userId]))[0];
    expect(row.role).toBe("ADMIN");
    expect(row.email_verified_at).not.toBeNull();
    expect(await bcrypt.compare("a-long-enough-password",String(row.password_hash))).toBe(true);
    expect(await lib.adminExists()).toBe(true);
    // The code is spent, and a second attempt (even with the same code) is refused as closed.
    expect(await lib.completeSetup({code,email:`second-${run}@example.test`,password:"a-long-enough-password"})).toEqual({ok:false,reason:"CLOSED"});
    expect(await lib.announceSetupIfNeeded(()=>undefined)).toBeNull();
    expect((await sql.unsafe("SELECT count(*)::int AS n FROM setup_codes"))[0].n).toBe(0);
  });

  it("lets only one of two simultaneous attempts win",async()=>{
    await sql.unsafe("UPDATE users SET role='USER' WHERE id=ANY($1::uuid[])",[created]);
    const code=(await lib.announceSetupIfNeeded(()=>undefined))!;
    const results=await Promise.all([
      lib.completeSetup({code,email:`race-a-${run}@example.test`,password:"a-long-enough-password"}),
      lib.completeSetup({code,email:`race-b-${run}@example.test`,password:"a-long-enough-password"})
    ]);
    for(const r of results)if(r.ok)created.push(r.userId);
    expect(results.filter((r)=>r.ok)).toHaveLength(1);
    const admins=await sql.unsafe("SELECT count(*)::int AS n FROM users WHERE role='ADMIN' AND email LIKE $1",[`race-%-${run}@example.test`]);
    expect(admins[0].n).toBe(1);
  });
});
