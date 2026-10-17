import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

type SessionUser={id:string;email:string;country:string;baseCurrency:string;timezone:string;role:string;anonymousAggregateOptIn:boolean};
const session=vi.hoisted(()=>({user:null as SessionUser|null}));
vi.mock("@/lib/session",()=>({
  requireUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;},
  requireAdmin:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");if(session.user.role!=="ADMIN")throw new Error("FORBIDDEN");return session.user;},
  requirePageUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;}
}));

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:3,prepare:false}):null;
const AUTH="rc-test-secret-"+Math.random().toString(36).slice(2);
const ORIGIN="http://127.0.0.1:3000";
const DAY=86_400_000;

describe.skipIf(!url)("App Store / Google Play subscriptions",()=>{
  const run=Math.random().toString(36).slice(2,8);
  const APPLE_PRO="com.test.pro.monthly."+run, APPLE_INV="com.test.inv.yearly."+run, GOOGLE_PRO="pro_monthly_"+run;
  let userId="",otherUserId="",freePlan="",proPlan="",investorPlan="";
  const saved:Record<string,string|undefined>={};
  let counter=0;

  async function send(event:Record<string,unknown>|null,auth:string|null=AUTH){
    const {POST}=await import("@/app/api/billing/store/webhook/route");
    const headers:Record<string,string>={"content-type":"application/json"};
    if(auth!==null)headers.authorization=auth;
    const body=event===null?"not json":JSON.stringify({api_version:"1.0",event:{
      id:"evt_"+run+"_"+(++counter),type:"RENEWAL",app_user_id:userId,product_id:APPLE_PRO,store:"APP_STORE",environment:"PRODUCTION",
      original_transaction_id:"txn_"+run+"_1",expiration_at_ms:Date.now()+30*DAY,event_timestamp_ms:Date.now()+counter,...event
    }});
    const response=await POST(new Request(ORIGIN+"/api/billing/store/webhook",{method:"POST",headers,body}));
    return {status:response.status,json:await response.json() as {outcome?:string;error?:string}};
  }
  const row=async(id=userId)=>(await sql!.unsafe("SELECT s.status,s.cadence,s.source,s.store_product_id,s.stripe_subscription_id,s.cancel_at_period_end,s.current_period_end,p.slug FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1",[id]))[0];
  const reset=async()=>{await sql!.unsafe("UPDATE subscriptions SET plan_id=$2,status='FREE',cadence='FREE',source='STRIPE',store_product_id=NULL,store_original_transaction_id=NULL,store_event_at=NULL,stripe_subscription_id=NULL,current_period_end=NULL,cancel_at_period_end=false WHERE user_id=$1",[userId,freePlan]);};

  beforeAll(async()=>{
    for(const k of ["REVENUECAT_WEBHOOK_AUTH","STORE_ALLOW_SANDBOX"])saved[k]=process.env[k];
    process.env.REVENUECAT_WEBHOOK_AUTH=AUTH;
    process.env.NEXT_PUBLIC_APP_URL=ORIGIN;
    const plans=await sql!.unsafe("SELECT id,slug FROM plans WHERE slug IN ('free','investor','pro')");
    const id=(slug:string)=>String(plans.find((p)=>p.slug===slug)!.id);
    freePlan=id("free");proPlan=id("pro");investorPlan=id("investor");
    await sql!.unsafe("UPDATE plan_prices SET apple_product_id=$1,google_product_id=$2 WHERE plan_id=$3 AND currency='GBP' AND cadence='MONTHLY'",[APPLE_PRO,GOOGLE_PRO,proPlan]);
    await sql!.unsafe("UPDATE plan_prices SET apple_product_id=$1 WHERE plan_id=$2 AND currency='GBP' AND cadence='ANNUAL'",[APPLE_INV,investorPlan]);
    for(const [label,setter] of [["main",(v:string)=>userId=v],["other",(v:string)=>otherUserId=v]] as const){
      const u=await sql!.unsafe("INSERT INTO users (email,password_hash) VALUES ($1,'x') RETURNING id",[`store-${label}-${run}@example.test`]);
      setter(String(u[0].id));
      await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'FREE','FREE')",[u[0].id,freePlan]);
    }
    const account=await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'Store','ISA','GB','GBP') RETURNING id",[userId]);
    for(let i=0;i<3;i++){
      const created=await sql!.unsafe("INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,$3 FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id",[userId,account[0].id,"S"+i]);
      await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[created[0].id,account[0].id]);
    }
    session.user={id:userId,email:`store-main-${run}@example.test`,country:"GB",baseCurrency:"GBP",timezone:"Europe/London",role:"USER",anonymousAggregateOptIn:false};
  });
  afterAll(async()=>{
    for(const k of Object.keys(saved)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
    if(!sql)return;
    await sql.unsafe("UPDATE plan_prices SET apple_product_id=NULL,google_product_id=NULL WHERE apple_product_id=ANY($1) OR google_product_id=ANY($1)",[[APPLE_PRO,APPLE_INV,GOOGLE_PRO]]);
    await sql.unsafe("DELETE FROM store_webhook_events WHERE event_id LIKE $1",["evt_"+run+"%"]);
    await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id=ANY($1::uuid[])",[[userId,otherUserId]]);
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])",[[userId,otherUserId]]);
    await sql.end();
  });

  it("refuses callers without the shared secret, and says so when none is configured",async()=>{
    expect((await send({},null)).status).toBe(401);
    expect((await send({},"wrong")).status).toBe(401);
    expect((await send({},"Bearer "+AUTH)).status).toBe(200);
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    expect((await send({})).status).toBe(503);
    process.env.REVENUECAT_WEBHOOK_AUTH=AUTH;
    expect((await row()).slug).toBe("pro");
    await reset();
  });

  it("turns a first purchase into a paid plan from the operator's product mapping",async()=>{
    const result=await send({type:"INITIAL_PURCHASE"});
    expect(result).toMatchObject({status:200,json:{outcome:"APPLIED"}});
    expect(await row()).toMatchObject({status:"ACTIVE",cadence:"MONTHLY",source:"APPLE",slug:"pro",store_product_id:APPLE_PRO,cancel_at_period_end:false});
  });

  it("ignores a replayed notification and an older one for the same subscription",async()=>{
    const first=await send({type:"RENEWAL",id:"evt_"+run+"_replay",event_timestamp_ms:Date.now()+10_000});
    expect(first.json.outcome).toBe("APPLIED");
    expect((await send({type:"RENEWAL",id:"evt_"+run+"_replay",event_timestamp_ms:Date.now()+10_000})).json.outcome).toBe("DUPLICATE");
    const stale=await send({type:"CANCELLATION",event_timestamp_ms:Date.now()-60_000});
    expect(stale.json.outcome).toBe("STALE");
    expect((await row()).cancel_at_period_end).toBe(false);
  });

  it("keeps access to the period end after a cancellation, and moves the period on renewal",async()=>{
    expect((await send({type:"CANCELLATION",cancel_reason:"UNSUBSCRIBE",event_timestamp_ms:Date.now()+20_000})).json.outcome).toBe("APPLIED");
    expect(await row()).toMatchObject({status:"ACTIVE",slug:"pro",cancel_at_period_end:true});
    const later=Date.now()+90*DAY;
    await send({type:"UNCANCELLATION",expiration_at_ms:later,event_timestamp_ms:Date.now()+30_000});
    const r=await row();
    expect(r.cancel_at_period_end).toBe(false);
    expect(Math.abs(new Date(r.current_period_end).getTime()-later)).toBeLessThan(1000);
  });

  it("follows a plan change and keeps paid access while a payment is being retried",async()=>{
    await send({type:"PRODUCT_CHANGE",product_id:APPLE_PRO,new_product_id:APPLE_INV,event_timestamp_ms:Date.now()+40_000});
    expect(await row()).toMatchObject({slug:"investor",cadence:"ANNUAL",store_product_id:APPLE_INV});
    await send({type:"BILLING_ISSUE",product_id:APPLE_INV,event_timestamp_ms:Date.now()+50_000});
    expect(await row()).toMatchObject({status:"PAST_DUE",slug:"investor"});
  });

  it("returns to the free plan on expiry, pausing strategies over the free limit",async()=>{
    await send({type:"INITIAL_PURCHASE",product_id:APPLE_PRO,event_timestamp_ms:Date.now()+60_000});
    const result=await send({type:"EXPIRATION",expiration_at_ms:Date.now()-1000,event_timestamp_ms:Date.now()+70_000});
    expect(result.json.outcome).toBe("ENDED");
    expect(await row()).toMatchObject({status:"FREE",cadence:"FREE",source:"STRIPE",slug:"free",store_product_id:null});
    const active=await sql!.unsafe("SELECT count(*)::int AS n FROM strategy_instances WHERE user_id=$1 AND status='ACTIVE'",[userId]);
    expect(active[0].n).toBeLessThanOrEqual(1);
  });

  it("does not let an old subscription's expiry end a newer one",async()=>{
    await reset();
    await send({type:"INITIAL_PURCHASE",original_transaction_id:"txn_new_"+run,event_timestamp_ms:Date.now()+80_000});
    const old=await send({type:"EXPIRATION",original_transaction_id:"txn_old_"+run,expiration_at_ms:Date.now()-1000,event_timestamp_ms:Date.now()+90_000});
    expect(old.json.outcome).toBe("IGNORED");
    expect(await row()).toMatchObject({status:"ACTIVE",slug:"pro"});
    await reset();
  });

  it("treats a refund as the end of access immediately",async()=>{
    await send({type:"INITIAL_PURCHASE",event_timestamp_ms:Date.now()+100_000});
    expect((await send({type:"CANCELLATION",cancel_reason:"CUSTOMER_SUPPORT",event_timestamp_ms:Date.now()+110_000})).json.outcome).toBe("ENDED");
    expect((await row()).slug).toBe("free");
  });

  it("never overwrites a live website subscription, and flags it for a person",async()=>{
    await sql!.unsafe("UPDATE subscriptions SET plan_id=$2,status='ACTIVE',cadence='MONTHLY',source='STRIPE',stripe_subscription_id=$3 WHERE user_id=$1",[userId,investorPlan,"sub_web_"+run]);
    const result=await send({type:"INITIAL_PURCHASE",original_transaction_id:"txn_conflict_"+run});
    expect(result.json.outcome).toBe("CONFLICT");
    expect(await row()).toMatchObject({source:"STRIPE",slug:"investor",stripe_subscription_id:"sub_web_"+run});
    const audit=await sql!.unsafe("SELECT metadata FROM audit_events WHERE actor_user_id=$1 AND action='billing.store-needs-review'",[userId]);
    expect(JSON.stringify(audit.map((a)=>a.metadata))).toContain("LIVE_WEBSITE_SUBSCRIPTION");
    await reset();
  });

  it("refuses a product that is not mapped to a plan, and an unknown or anonymous user",async()=>{
    expect((await send({type:"INITIAL_PURCHASE",product_id:"com.unknown."+run})).json.outcome).toBe("UNKNOWN_PRODUCT");
    expect((await send({type:"INITIAL_PURCHASE",app_user_id:randomUUID()})).json.outcome).toBe("UNKNOWN_USER");
    expect((await send({type:"INITIAL_PURCHASE",app_user_id:"$RCAnonymousID:abc"})).json.outcome).toBe("UNKNOWN_USER");
    expect((await row()).slug).toBe("free");
  });

  it("accepts sandbox purchases only where the operator allowed them",async()=>{
    delete process.env.STORE_ALLOW_SANDBOX;
    expect((await send({type:"INITIAL_PURCHASE",environment:"SANDBOX"})).json.outcome).toBe("SANDBOX_REFUSED");
    expect((await row()).slug).toBe("free");
    process.env.STORE_ALLOW_SANDBOX="true";
    expect((await send({type:"INITIAL_PURCHASE",environment:"SANDBOX",event_timestamp_ms:Date.now()+120_000})).json.outcome).toBe("APPLIED");
    delete process.env.STORE_ALLOW_SANDBOX;
    await reset();
  });

  it("maps Google Play products separately and ignores events from other stores",async()=>{
    expect((await send({type:"INITIAL_PURCHASE",store:"PLAY_STORE",product_id:GOOGLE_PRO,original_transaction_id:"GPA.1234"})).json.outcome).toBe("APPLIED");
    expect(await row()).toMatchObject({source:"GOOGLE",slug:"pro"});
    expect((await send({type:"INITIAL_PURCHASE",store:"STRIPE"})).json.outcome).toBe("IGNORED");
    expect((await send({type:"INITIAL_PURCHASE",store:"PLAY_STORE",product_id:APPLE_PRO,original_transaction_id:"GPA.9"})).json.outcome).toBe("UNKNOWN_PRODUCT");
    await reset();
  });

  it("does not touch other accounts and ignores notifications that are not subscription changes",async()=>{
    expect((await send({type:"TEST"})).json.outcome).toBe("IGNORED");
    expect((await send({type:"NON_RENEWING_PURCHASE"})).json.outcome).toBe("IGNORED");
    expect((await send({type:"TRANSFER"})).json.outcome).toBe("IGNORED");
    expect((await row(otherUserId)).slug).toBe("free");
    expect((await send(null)).status).toBe(400);
    const odd=await send({id:undefined,type:undefined} as never);
    expect(odd.status).toBe(200);
  });

  it("blocks website checkout and the billing portal for someone billed through a store",async()=>{
    process.env.STRIPE_SECRET_KEY="sk_test_store_guard";
    await send({type:"INITIAL_PURCHASE",event_timestamp_ms:Date.now()+130_000,original_transaction_id:"txn_guard_"+run});
    const {POST:checkout}=await import("@/app/api/billing/checkout/route");
    const attempt=await checkout(new Request(ORIGIN+"/api/billing/checkout",{method:"POST",headers:{origin:ORIGIN,"content-type":"application/json"},body:JSON.stringify({planSlug:"investor",cadence:"monthly",recurringBillingAcknowledged:true})}));
    // Either the paid-launch gate or the store guard stops it; it must never reach Stripe.
    expect([403,409,503]).toContain(attempt.status);
    const {POST:portal}=await import("@/app/api/billing/portal/route");
    const portalResponse=await portal(new Request(ORIGIN+"/api/billing/portal",{method:"POST",headers:{origin:ORIGIN}}));
    expect(portalResponse.status).toBe(409);
    expect((await portalResponse.json() as {error:string}).error).toMatch(/App Store/);
    delete process.env.STRIPE_SECRET_KEY;
    await reset();
  });

  it("reports billing status to the signed-in user only",async()=>{
    await send({type:"INITIAL_PURCHASE",event_timestamp_ms:Date.now()+140_000,original_transaction_id:"txn_status_"+run});
    const {GET}=await import("@/app/api/billing/status/route");
    const mine=await (await GET()).json() as {plan:{slug:string};billedBy:string;status:string};
    expect(mine).toMatchObject({plan:{slug:"pro"},billedBy:"APPLE",status:"ACTIVE"});
    session.user=null;
    expect((await GET()).status).toBe(401);
    session.user={id:otherUserId,email:"o@example.test",country:"GB",baseCurrency:"GBP",timezone:"Europe/London",role:"USER",anonymousAggregateOptIn:false};
    expect((await (await GET()).json() as {plan:{slug:string}}).plan.slug).toBe("free");
  });
});
