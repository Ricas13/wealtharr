import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import postgres from "postgres";

// Uses the real admin route and real PostgreSQL constraints; Stripe is not contacted.
const session=vi.hoisted(()=>({id:""}));
vi.mock("@/lib/session",()=>({
  requireAdmin:async()=>({id:session.id,role:"ADMIN"})
}));
const url=process.env.DATABASE_URL;
const db=url?postgres(url,{max:2,prepare:false}):null;
const origin="http://127.0.0.1:3000";
const run=Math.random().toString(36).slice(2,11);
const firstSlug="price-history-a-"+run;
const secondSlug="price-history-b-"+run;
const oldPrice="price_history_old_"+run;
const newPrice="price_history_new_"+run;

describe.skipIf(!url)("Master Admin preserves Stripe subscriptions across price changes",()=>{
  let admin="";
  async function update(planSlug:string,currency:string,cadence:"MONTHLY"|"ANNUAL",amountMinor:number,stripePriceId:string|null){
    const {PUT}=await import("@/app/api/admin/plan-prices/route");
    const response=await PUT(new Request(origin+"/api/admin/plan-prices",{
      method:"PUT",headers:{"origin":origin,"content-type":"application/json"},
      body:JSON.stringify({planSlug,currency,cadence,amountMinor,stripePriceId,active:true})
    }));
    return {status:response.status,body:await response.json()};
  }
  beforeAll(async()=>{
    process.env.NEXT_PUBLIC_APP_URL=origin;
    const users=await db!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id",
      ["price-history-"+run+"@example.test"]);
    admin=String(users[0].id);session.id=admin;
    for(const slug of [firstSlug,secondSlug]){
      await db!.unsafe("INSERT INTO plans (slug,display_name) VALUES ($1,$2)",[slug,"Price history "+slug]);
    }
  });
  afterAll(async()=>{
    if(!db)return;
    const ids=[firstSlug,secondSlug];
    await db.unsafe("DELETE FROM stripe_price_mappings WHERE plan_id IN (SELECT id FROM plans WHERE slug=ANY($1::text[]))",[ids]);
    await db.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[admin]);
    await db.unsafe("DELETE FROM plans WHERE slug=ANY($1::text[])",[ids]);
    await db.unsafe("DELETE FROM users WHERE id=$1",[admin]);
    await db.end();
  });

  it("retains original amount, currency and cadence when an existing Stripe price is superseded",async()=>{
    expect((await update(firstSlug,"GBP","MONTHLY",999,oldPrice)).status).toBe(200);
    expect((await update(firstSlug,"GBP","MONTHLY",1299,null)).status).toBe(200);
    const old=await db!.unsafe(
      "SELECT m.amount_minor,m.currency,m.cadence,p.slug FROM stripe_price_mappings m JOIN plans p ON p.id=m.plan_id WHERE m.stripe_price_id=$1",
      [oldPrice]
    );
    expect(old).toHaveLength(1);
    expect(old[0]).toMatchObject({amount_minor:999,currency:"GBP",cadence:"MONTHLY",slug:firstSlug});
    expect((await update(firstSlug,"GBP","MONTHLY",1299,newPrice)).status).toBe(200);
    const latest=await db!.unsafe(
      "SELECT pp.stripe_price_id,pp.amount_minor FROM plan_prices pp JOIN plans p ON p.id=pp.plan_id WHERE p.slug=$1 AND pp.currency='GBP' AND pp.cadence='MONTHLY'",
      [firstSlug]
    );
    expect(latest[0]).toMatchObject({stripe_price_id:newPrice,amount_minor:1299});
    const archived=await db!.unsafe("SELECT amount_minor FROM stripe_price_mappings WHERE stripe_price_id=$1",[oldPrice]);
    expect(archived[0].amount_minor).toBe(999);
  });

  it("does not allow historic Stripe price reuse across plans, currency or cadence",async()=>{
    const wrongPlan=await update(secondSlug,"GBP","MONTHLY",999,oldPrice);
    expect(wrongPlan.status).toBe(409);
    expect(wrongPlan.body.error).toMatch(/another plan/i);
    const wrongCurrency=await update(firstSlug,"USD","MONTHLY",999,oldPrice);
    expect(wrongCurrency.status).toBe(409);
    expect(wrongCurrency.body.error).toMatch(/currency or billing cycle/i);
    const wrongCadence=await update(firstSlug,"GBP","ANNUAL",999,oldPrice);
    expect(wrongCadence.status).toBe(409);
    expect(wrongCadence.body.error).toMatch(/currency or billing cycle/i);
  });
});
