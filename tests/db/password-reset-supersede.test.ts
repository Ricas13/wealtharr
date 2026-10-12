import { afterAll,beforeAll,describe,expect,it } from "vitest";
import postgres from "postgres";

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:2,prepare:false}):null;
const ORIGIN="http://127.0.0.1:3000";

describe.skipIf(!url)("password reset links",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const email=`reset-${run}@example.test`;
  let userId="";

  async function request(){
    const {POST}=await import("@/app/api/password-reset/request/route");
    const response=await POST(new Request(ORIGIN+"/api/password-reset/request",{
      method:"POST",
      headers:{origin:ORIGIN,"content-type":"application/json","x-forwarded-for":"203.0.113."+Math.floor(Math.random()*200)},
      body:JSON.stringify({email})
    }));
    return response.status;
  }
  const live=async()=>(await sql!.unsafe("SELECT id FROM auth_tokens WHERE user_id=$1 AND type='RESET_PASSWORD' AND used_at IS NULL AND expires_at>now()",[userId])).length;

  beforeAll(async()=>{
    process.env.NEXT_PUBLIC_APP_URL=ORIGIN;
    process.env.EMAIL_PROVIDER="mock";
    process.env.APP_ENCRYPTION_KEY??="MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
    // The request limit is per address; start from a clean window so reruns do not hit it.
    await sql!.unsafe("DELETE FROM rate_limits WHERE key LIKE 'reset:%'");
    const rows=await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",[email]);
    userId=String(rows[0].id);
  });
  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM auth_tokens WHERE user_id=$1",[userId]);
    await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[userId]);
    await sql.unsafe("DELETE FROM users WHERE id=$1",[userId]);
    await sql.end();
  });

  it("leaves only the newest link usable after repeated requests",async()=>{
    expect(await request()).toBe(200);
    expect(await live()).toBe(1);
    expect(await request()).toBe(200);
    expect(await request()).toBe(200);
    expect(await live()).toBe(1);
    const all=await sql!.unsafe("SELECT count(*)::int AS n FROM auth_tokens WHERE user_id=$1 AND type='RESET_PASSWORD'",[userId]);
    expect(all[0].n).toBe(3);
  });
});
