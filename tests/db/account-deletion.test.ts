import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import postgres from "postgres";
import Stripe from "stripe";
import bcrypt from "bcryptjs";

// Real route, real worker function, real database. Stripe's customer API is faked so its failure
// can be controlled; only the session lookup is replaced to choose the caller.
type SessionUser={id:string;email:string;country:string;baseCurrency:string;timezone:string;role:string;anonymousAggregateOptIn:boolean;authTime?:number};
const state=vi.hoisted(()=>({user:null as SessionUser|null,deleteCustomer:null as null|((id:string)=>Promise<unknown>),deleted:[] as string[]}));
vi.mock("@/lib/session",()=>({
  requireUser:async()=>{if(!state.user)throw new Error("UNAUTHENTICATED");return state.user;},
  requireAdmin:async()=>{if(!state.user)throw new Error("UNAUTHENTICATED");return state.user;},
  requirePageUser:async()=>{if(!state.user)throw new Error("UNAUTHENTICATED");return state.user;}
}));
vi.mock("stripe",async(importOriginal)=>{
  const original=await importOriginal<typeof import("stripe")>();
  const Real=original.default as unknown as new(...args:unknown[])=>object;
  class FakeStripe extends Real {
    customers={del:async(id:string)=>{
      if(state.deleteCustomer)await state.deleteCustomer(id);
      state.deleted.push(id);
      return {id,deleted:true};
    }};
    subscriptions={retrieve:async(id:string)=>({id,status:"canceled"}),cancel:async(id:string)=>({id,status:"canceled"})};
  }
  return {...original,default:FakeStripe};
});

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:2,prepare:false}):null;
const ORIGIN="http://127.0.0.1:3000";
void Stripe;
const PASSWORD="correct horse battery staple";

describe.skipIf(!url)("account deletion",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const created:string[]=[];

  async function makeUser(label:string,withStripe:boolean,hasPassword=true){
    const users=await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,$2) RETURNING id",[`del-${label}-${run}@example.test`,hasPassword?bcrypt.hashSync(PASSWORD,4):null]);
    const id=String(users[0].id);
    created.push(id);
    const free=await sql!.unsafe("SELECT id FROM plans WHERE slug='free'");
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence,stripe_customer_id) VALUES ($1,$2,'FREE','FREE',$3)",[id,free[0].id,withStripe?`cus_del_${label}_${run}`:null]);
    const account=await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'A','ISA','GB','GBP') RETURNING id",[id]);
    state.user={id,email:`del-${label}-${run}@example.test`,country:"GB",baseCurrency:"GBP",timezone:"Europe/London",role:"USER",anonymousAggregateOptIn:true,authTime:Date.now()};
    return {id,accountId:String(account[0].id),customerId:`cus_del_${label}_${run}`};
  }
  async function callDelete(body:unknown={password:PASSWORD}){
    const {DELETE}=await import("@/app/api/account/delete/route");
    const response=await DELETE(new Request(ORIGIN+"/api/account/delete",{method:"DELETE",headers:{origin:ORIGIN,"content-type":"application/json"},body:JSON.stringify(body)}));
    return {status:response.status,json:await response.json() as {ok?:boolean;completed?:boolean;error?:string;code?:string}};
  }
  const userRow=async(id:string)=>(await sql!.unsafe("SELECT id,deleted_at FROM users WHERE id=$1",[id]))[0];

  beforeAll(()=>{
    process.env.NEXT_PUBLIC_APP_URL=ORIGIN;
    process.env.STRIPE_SECRET_KEY="sk_test_deletion";
  });
  afterAll(async()=>{
    if(!sql)return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])",[created]);
    await sql.unsafe("DELETE FROM audit_events WHERE entity_id=ANY($1)",[created]);
    await sql.end();
  });

  it("needs the current password: a session alone cannot delete the account",async()=>{
    const {id}=await makeUser("reauth",false);
    expect((await callDelete({})).status).toBe(400);
    expect((await callDelete({password:"not the password"})).status).toBe(400);
    expect((await callDelete({confirmEmail:state.user!.email})).status).toBe(400);
    expect(await userRow(id)).toMatchObject({deleted_at:null});
    expect(await callDelete({password:PASSWORD})).toMatchObject({status:200,json:{completed:true}});
    expect(await userRow(id)).toBeUndefined();
  });

  it("lets a provider-only account delete with a recent sign-in and its typed email, and nothing less",async()=>{
    const {id}=await makeUser("oauth",false,false);
    const email=state.user!.email;
    expect((await callDelete({})).status).toBe(400);
    expect((await callDelete({confirmEmail:"someone-else@example.test"})).status).toBe(400);
    state.user={...state.user!,authTime:Date.now()-60*60*1000};
    const stale=await callDelete({confirmEmail:email});
    expect(stale.status).toBe(403);
    expect(stale.json.code).toBe("SIGN_IN_AGAIN");
    expect(await userRow(id)).toMatchObject({deleted_at:null});
    state.user={...state.user!,authTime:Date.now()};
    expect(await callDelete({confirmEmail:email.toUpperCase()})).toMatchObject({status:200,json:{completed:true}});
    expect(await userRow(id)).toBeUndefined();
  });

  it("also asks for a current code when two-step sign-in is on",async()=>{
    const {id}=await makeUser("mfa",false);
    await sql!.unsafe("UPDATE users SET mfa_enabled_at=now(),mfa_secret_encrypted='not-a-real-secret' WHERE id=$1",[id]);
    expect((await callDelete({password:PASSWORD})).status).toBe(400);
    expect(await userRow(id)).toMatchObject({deleted_at:null});
  });

  it("deletes an account with no billing in one step",async()=>{
    const {id}=await makeUser("plain",false);
    state.deleteCustomer=null;
    expect(await callDelete()).toMatchObject({status:200,json:{ok:true,completed:true}});
    expect(await userRow(id)).toBeUndefined();
  });

  it("removes the Stripe customer and then the data",async()=>{
    const {id,customerId}=await makeUser("billed",true);
    state.deleteCustomer=null;
    state.deleted.length=0;
    expect(await callDelete()).toMatchObject({status:200,json:{completed:true}});
    expect(state.deleted).toEqual([customerId]);
    expect(await userRow(id)).toBeUndefined();
  });

  it("closes the account immediately and keeps it closed when Stripe is down, then the worker finishes it",async()=>{
    const {id,accountId}=await makeUser("stalled",true);
    state.deleteCustomer=async()=>{throw new Error("stripe unreachable");};
    const result=await callDelete();
    expect(result.status).toBe(202);
    expect(result.json).toMatchObject({ok:true,completed:false});

    // Locked out and data still there for the retry, but the account no longer counts as live.
    const pending=await userRow(id);
    expect(pending?.deleted_at).toBeTruthy();
    const live=await sql!.unsafe("SELECT 1 FROM users WHERE id=$1 AND deleted_at IS NULL",[id]);
    expect(live).toHaveLength(0);
    expect(await sql!.unsafe("SELECT 1 FROM accounts WHERE id=$1",[accountId])).toHaveLength(1);

    const {finishPendingAccountDeletions}=await import("@/lib/account-deletion");
    // Inside the grace window the worker leaves it alone (the request may still be finishing).
    expect(await finishPendingAccountDeletions()).toMatchObject({completed:0});
    await sql!.unsafe("UPDATE users SET deleted_at=now()-interval '10 minutes' WHERE id=$1",[id]);

    // Stripe still failing: reported as stalled, nothing lost.
    expect(await finishPendingAccountDeletions()).toMatchObject({stalled:1});
    expect(await userRow(id)).toBeTruthy();

    // Stripe recovers: the retry completes the deletion.
    state.deleteCustomer=null;
    expect(await finishPendingAccountDeletions()).toMatchObject({completed:1,stalled:0});
    expect(await userRow(id)).toBeUndefined();
    expect(await sql!.unsafe("SELECT 1 FROM accounts WHERE id=$1",[accountId])).toHaveLength(0);
  });

  it("treats a customer Stripe has already deleted as done",async()=>{
    const {id}=await makeUser("gone",true);
    state.deleteCustomer=async()=>{throw Object.assign(new Error("No such customer"),{code:"resource_missing"});};
    expect(await callDelete()).toMatchObject({status:200,json:{completed:true}});
    expect(await userRow(id)).toBeUndefined();
  });

  it("refuses, without closing the account, when billing exists but Stripe is not configured",async()=>{
    const {id}=await makeUser("nokey",true);
    const key=process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try{
      const result=await callDelete();
      expect(result.status).toBe(503);
      const row=await userRow(id);
      expect(row?.deleted_at).toBeNull();
    }finally{process.env.STRIPE_SECRET_KEY=key;}
  });

  it("never purges an account that was not marked deleted",async()=>{
    const {id}=await makeUser("live",false);
    const {finishAccountDeletion}=await import("@/lib/account-deletion");
    await finishAccountDeletion(id);
    expect(await userRow(id)).toBeTruthy();
  });
});
